#!/usr/bin/env python3
"""Run the GTEki merge lane, or use add/remove/list/--dry-run from the director directory."""

import argparse
from contextlib import contextmanager
from datetime import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import time
from zoneinfo import ZoneInfo


DIRECTOR = Path(__file__).resolve().parent
QUEUE = DIRECTOR / "merge-lane-candidates.json"
REPO = "nurockplayer/gteki"
LEAD = "gteki-lead"
FIELDS = (
    "state,isDraft,mergeable,mergeStateStatus,baseRefName,baseRefOid,headRefOid,"
    "statusCheckRollup,autoMergeRequest"
)
WORKFLOWS = {"E2E smoke", "GIS tools tests", "REUSE licence lint", "Root tests"}
PASSED = {"SUCCESS", "NEUTRAL", "SKIPPED"}


def call(*args):
    return subprocess.check_output(args, text=True, cwd=DIRECTOR).strip()


def gh(command, *args):
    return call("gh", command, *args, "-R", REPO)


def api(path, *args):
    return call("gh", "api", f"repos/{REPO}/{path}", *args)


def log(message):
    stamp = datetime.now(ZoneInfo("Asia/Tokyo")).strftime("%F %T %Z")
    with (DIRECTOR / "merge-lane.log").open("a") as stream:
        print(f"{stamp} {message}", file=stream)


@contextmanager
def lock(name, mode=fcntl.LOCK_EX):
    with (DIRECTOR / name).open("a") as stream:
        fcntl.flock(stream, mode)
        yield


def load():
    return json.loads(QUEUE.read_text())


def save(queue):
    temp = QUEUE.with_suffix(".tmp")
    temp.write_text(json.dumps(queue, indent=2) + "\n")
    temp.replace(QUEUE)


def view(number):
    return json.loads(gh("pr", "view", str(number), "--json", FIELDS))


def pending_waiters(number):
    waiting = []
    for row in call("lead-wait", "--role", LEAD, "list").splitlines():
        _, job, kind, ref, _ = row.split("\t", 4)
        if (kind, ref) in {("pr", f"#{number}"), ("run", f"gate-{number}")}:
            waiting.append(job)
    return waiting


def last_gate_event(number):
    for row in reversed(call("lead-inbox", "list", LEAD, "--all").splitlines()):
        event, _, kind, ref, outcome, detail, *_ = row.split("\t")
        if kind == "pr" and ref == f"#{number}":
            return event, outcome, detail
    return None, None, None


def plan(pr, active):
    if pr["state"] == "MERGED":
        return "merged", "merged"
    if pr["state"] != "OPEN" or pr["isDraft"] or pr["baseRefName"] != "main":
        return "failed", "PR is closed, draft, or no longer targets main"
    if pr["mergeable"] == "CONFLICTING":
        return "failed", "merge conflict with main"
    if pr["mergeable"] == "UNKNOWN" or pr["mergeStateStatus"] == "UNKNOWN":
        return "wait", "waiting for GitHub to compute mergeability"

    head = pr["headRefOid"]
    if active.get("updated_from") == head:
        return "wait", f"waiting for the branch update from {head[:12]}"
    behind = pr["mergeStateStatus"] == "BEHIND"
    if pr["mergeStateStatus"] == "BLOCKED":
        # A required check can mask BEHIND in mergeStateStatus.
        behind = int(api(f"compare/{pr['baseRefOid']}...{head}", "--jq", ".behind_by")) > 0
    if behind:
        if "updated_from" in active:
            return "failed", "behind main after its one branch update"
        return "update", f"update branch once from {head[:12]}, then wait for the new head's checks"

    pending = []
    failed = []
    checks = pr["statusCheckRollup"]
    if not checks:
        return "wait", f"waiting for checks to appear on {head[:12]}"
    for check in checks:
        if check["__typename"] == "StatusContext":
            if check["state"] in {"PENDING", "EXPECTED"}:
                pending.append(check["context"])
            elif check["state"] != "SUCCESS":
                failed.append(check["context"])
        elif check["status"] != "COMPLETED":
            pending.append(check["name"])
        elif check["conclusion"] not in PASSED:
            failed.append(check["name"])
    if pending:
        return "wait", f"waiting for full CI rollup on {head[:12]} ({', '.join(pending)})"

    # A parent Actions job can finish before its matrix jobs appear in the rollup.
    runs = json.loads(gh("run", "list", "--commit", head, "--event", "pull_request",
                         "--json", "workflowName,status,conclusion"))
    missing = WORKFLOWS - {run["workflowName"] for run in runs}
    if missing or any(run["status"] != "completed" for run in runs):
        return "wait", f"waiting for all PR workflows on {head[:12]} to finish"
    failed.extend(run["workflowName"] for run in runs if run["conclusion"].upper() not in PASSED)
    if failed:
        return "failed", f"checks failed on {head[:12]}: {', '.join(dict.fromkeys(failed))}"

    gated = any(check.get("context") == "review-gate" and check["state"] == "SUCCESS"
                for check in checks)
    if gated and pr["autoMergeRequest"]:
        return "wait", f"waiting for GitHub to merge gated head {head[:12]}"
    return "gate", f"run lead-wait pr for {head[:12]} after all checks passed"


def disarm(number, pr):
    if pr["autoMergeRequest"]:
        gh("pr", "merge", str(number), "--disable-auto")


def drop(queue, number):
    queue["candidates"].remove(number)
    if queue["active"] and queue["active"]["number"] == number:
        queue["active"] = None
    save(queue)


def step(queue, dry_run=False):
    candidates = queue["candidates"]
    if not candidates:
        return "merge lane is empty"

    active = queue["active"] or {"number": candidates[0]}
    number = active["number"]
    # Wait before reading the PR so the snapshot includes the old gate's last writes.
    waiters = [job for job in pending_waiters(number) if job != active.get("job")]
    pr = view(number)
    if waiters and pr["state"] != "MERGED":
        return f"#{number} waiting for existing gate job(s): {', '.join(waiters)}"
    if queue["active"] is None and not dry_run:
        queue["active"] = active
        save(queue)

    if "job" in active and pr["state"] != "MERGED":
        job = active["job"]
        status = call("job-run", "--status", job)
        if status == "running":
            return f"#{number} waiting for {job}"
        event, outcome, detail = last_gate_event(number)
        if pr["headRefOid"] != active["gate_head"]:
            action, message = "wait", "head changed during review; checking the new head"
        elif status == "done ok 0" and event != active["prior_event"] and outcome == "merged-armed":
            action, message = plan(pr, active)
            if action == "gate":
                action, message = "failed", "gate finished but GitHub reports neither armed nor merged"
        else:
            reason = detail if event != active["prior_event"] and detail else f"{job}: {status}"
            action, message = "failed", reason
        if not dry_run:
            for key in ("job", "gate_head", "prior_event"):
                del active[key]
            save(queue)
    else:
        action, message = plan(pr, active)

    message = f"#{number} {message}"
    if dry_run:
        return message
    if action == "merged":
        drop(queue, number)
        log(message)
    elif action == "failed":
        disarm(number, pr)
        call("lead-inbox", "add", LEAD, "merge-lane", f"#{number}", "failed", message)
        drop(queue, number)
        log(message)
    elif action == "update":
        disarm(number, pr)
        head = pr["headRefOid"]
        api(f"pulls/{number}/update-branch", "-X", "PUT", "-f", f"expected_head_sha={head}")
        active["updated_from"] = head
        save(queue)
    elif action == "gate":
        disarm(number, pr)
        prior_event, _, _ = last_gate_event(number)
        result = call("lead-wait", "--role", LEAD, "pr", str(number))
        job = re.search(r"^lead-wait: (lw-pr-\S+) started;", result, re.MULTILINE)
        if not job:
            raise SystemExit(f"Could not read the lead-wait job ID from {result!r}")
        active.update(job=job[1], gate_head=pr["headRefOid"], prior_event=prior_event)
        save(queue)
    return message


def main():
    os.environ["PATH"] = (f"{Path.home()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:"
                          + os.environ["PATH"])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    commands = parser.add_subparsers(dest="command")
    for command in ("add", "remove"):
        commands.add_parser(command).add_argument("number", type=int)
    commands.add_parser("list")
    commands.add_parser("run")
    args = parser.parse_args()

    if args.dry_run:
        if args.command:
            parser.error("--dry-run takes no command")
        queue = load()
        print(f"{len(queue['candidates'])} candidate(s); {step(queue, dry_run=True)}")
    elif args.command == "list":
        queue = load()
        active = queue["active"]
        if active:
            print(f"{active['number']} (active)")
        for number in queue["candidates"]:
            if not active or number != active["number"]:
                print(number)
    elif args.command in {"add", "remove"}:
        with lock(".merge-lane.lock"):
            queue = load()
            number = args.number
            if args.command == "add":
                pr = view(number)
                if pr["state"] != "OPEN" or pr["isDraft"] or pr["baseRefName"] != "main":
                    parser.error(f"#{number} must be an open non-draft PR targeting main")
                if number not in queue["candidates"]:
                    queue["candidates"].append(number)
                    queue["candidates"].sort()
                    save(queue)
                    log(f"#{number} added")
            elif number in queue["candidates"]:
                active = queue["active"]
                if active and active["number"] == number:
                    if "job" in active or pending_waiters(number):
                        parser.error(f"#{number} has an active gate job; remove it after the gate finishes")
                    disarm(number, view(number))
                drop(queue, number)
                log(f"#{number} removed")
    elif args.command == "run":
        with lock(".merge-lane-run.lock", fcntl.LOCK_EX | fcntl.LOCK_NB):
            previous = None
            while True:
                with lock(".merge-lane.lock"):
                    queue = load()
                    before = len(queue["candidates"])
                    message = step(queue)
                if before != len(queue["candidates"]):
                    continue
                if message != previous:
                    log(message)
                    previous = message
                time.sleep(60)
    else:
        parser.error("use add, remove, list, run or --dry-run")


if __name__ == "__main__":
    main()
