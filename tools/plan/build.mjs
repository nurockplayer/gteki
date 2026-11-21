// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '../..');
const statuses = ['PASS', 'FAIL', 'REVIEW', 'BLOCKED', 'NOT JUDGED', 'STALE'];
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const link = (value) => text(value) && /^https:\/\/\S+$/.test(value);
const date = (value) => text(value) && /^\d{4}-\d{2}-\d{2}.*(?:JST|UTC|[+-]\d{2}:\d{2}|Z)$/.test(value);
const requireField = (condition, message) => { if (!condition) throw new Error(message); };

export function validatePlan(plan) {
  requireField(plan.schema_version === 1 && text(plan.project) && ['ACTIVE', 'DORMANT'].includes(plan.state), 'Plan needs schema_version: 1, project and state ACTIVE or DORMANT');
  requireField((plan.owner_decisions == null || Array.isArray(plan.owner_decisions)) && Array.isArray(plan.workstreams), 'Plan needs workstreams; owner_decisions must be a list');
  const ids = new Set();
  const unique = (id) => {
    requireField(text(id) && !ids.has(id), `Missing or duplicate id: ${id}`);
    ids.add(id);
  };
  for (const decision of plan.owner_decisions ?? []) {
    unique(decision.id);
    requireField(text(decision.question) && text(decision.recommendation) && date(decision.deadline), `${decision.id}: question, recommendation and zoned deadline required`);
    requireField(Array.isArray(decision.options) && decision.options.length >= 2 && decision.options.every(text) && decision.options.includes(decision.recommendation), `${decision.id}: options and recommendation required`);
    requireField(['OPEN', 'ANSWERED'].includes(decision.state), `${decision.id}: state must be OPEN or ANSWERED`);
    requireField(decision.state !== 'ANSWERED' || (decision.options.includes(decision.answer) && link(decision.answer_ref)), `${decision.id}: ANSWERED needs an answer and answer_ref link`);
  }
  for (const stream of plan.workstreams) {
    unique(stream.id);
    requireField(['title', 'outcome', 'lead', 'next_step'].every(key => text(stream[key])), `${stream.id}: title, outcome, lead and next_step required`);
    requireField(Array.isArray(stream.phases) && stream.phases.every(p => text(p.id) && text(p.title)) && stream.phases.some(p => p.id === stream.current_phase), `${stream.id}: phases and current_phase required`);
    requireField(Array.isArray(stream.criteria), `${stream.id}: criteria required`);
    for (const row of stream.criteria) {
      unique(row.id);
      requireField(text(row.requirement) && statuses.includes(row.status), `${row.id}: requirement and valid status required`);
      requireField(text(row.judge), `${row.id}: judge required`);
      requireField(row.evidence == null || (Array.isArray(row.evidence) && row.evidence.every(e => text(e.label) && link(e.url))), `${row.id}: evidence must contain labelled HTTPS links`);
      requireField(row.status !== 'PASS' || (date(row.verified_at) && text(row.verified_sha) && row.evidence?.length > 0), `${row.id}: PASS needs a judge, verified_at, verified_sha and at least one evidence link. A merged PR or green CI alone is never PASS.`);

    }
  }
  return plan;
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const anchor = (label, url) => `<a href="${escape(url)}">${escape(label)}</a>`;
const count = rows => `${rows.filter(row => row.status === 'PASS').length} / ${rows.length}`;

function render(plan, sha, builtAt) {
  const waiting = (plan.owner_decisions ?? []).filter(d => d.state === 'OPEN');
  const decisions = waiting.length ? `<section aria-labelledby="waiting"><h2 id="waiting">Waiting for the Owner</h2><p>Reply in your chat: DEC-n: &lt;option&gt;. Leads record your answer in the plan.</p>${waiting.map(d => `<article class="decision"><h3>${escape(d.id)} · ${escape(d.question)}</h3><ul>${d.options.map(o => `<li>${escape(o)}</li>`).join('')}</ul><p><strong>Lead recommendation:</strong> ${escape(d.recommendation)}</p><p><strong>Deadline:</strong> ${escape(d.deadline)}</p></article>`).join('')}</section>` : '';
  const streams = plan.workstreams.map(s => `<section id="${escape(s.id)}" aria-labelledby="title-${escape(s.id)}">
    <h2 id="title-${escape(s.id)}">${escape(s.id)} · ${escape(s.title)}</h2><p class="goal">${escape(s.outcome)}</p>
    <ol class="phases">${s.phases.map(p => `<li${p.id === s.current_phase ? ' aria-current="step"' : ''}>${escape(p.title)}${p.id === s.current_phase ? ' <strong>← Current</strong>' : ''}</li>`).join('')}</ol>
    <p><strong>${count(s.criteria)} criteria PASS</strong></p>
    ${(s.context ?? []).map(n => `<p class="note">${escape(n)}</p>`).join('')}
    ${(s.references ?? []).map(p => `<p>${anchor(p.label,p.url)}</p>`).join('')}
    <table><caption>Acceptance · ${escape(s.id)}</caption><thead><tr><th scope="col">Criterion</th><th scope="col">Requirement</th><th scope="col">Judged by</th><th scope="col">Status</th><th scope="col">Evidence</th></tr></thead><tbody>${s.criteria.map(r => `<tr id="${escape(r.id)}">
      <th scope="row">${escape(r.id)}</th><td data-label="Requirement">${r.context ? `<small>${escape(r.context)}</small>` : ''}<div class="requirement">${escape(r.requirement)}</div>${(r.references ?? []).map(p => anchor(p.label,p.url)).join(' · ')}</td>
      <td data-label="Judged by">${escape(r.judge || 'Not recorded')}<small>${escape(r.verified_at || 'Date not recorded')}</small></td>
      <td data-label="Status"><strong class="status ${r.status.toLowerCase().replaceAll(' ','-')}">${escape(r.status)}</strong>${r.status_detail ? `<details><summary>Original judgement</summary><p>${escape(r.status_detail)}</p></details>` : ''}</td>
      <td data-label="Evidence">${r.evidence?.length ? `<ul>${r.evidence.map(e => `<li>${anchor(e.label,e.url)}</li>`).join('')}</ul>${r.verified_sha ? `<small>Verified SHA: ${escape(r.verified_sha)}</small>` : ''}` : 'No evidence recorded'}</td>
    </tr>`).join('')}</tbody></table>
    <p><strong>Next step:</strong> ${escape(s.next_step)}</p><p><strong>Owning lead:</strong> ${escape(s.lead)}</p></section>`).join('');
  const values = {title:escape(`${plan.project} plan & acceptance`),sha:escape(sha.slice(0,8)),builtAt:escape(builtAt),progress:count(plan.workstreams.flatMap(s=>s.criteria)),state:escape(plan.state),decisions,streams,nav:plan.workstreams.map(s=>anchor(s.id,`#${s.id}`)).join(' · ')};
  return fs.readFileSync(path.join(root,'tools/plan/page.html'),'utf8').replace(/\{\{(\w+)\}\}/g,(_,key)=>values[key]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const plan = validatePlan(parse(fs.readFileSync(path.join(root,'docs/release/plan.yaml'),'utf8')));
  const release = plan.workstreams.find(s => s.id === 'RELEASE');
  const journeyFile = path.join(root,'docs/release/journey.md');
  const currentJourney = fs.readFileSync(journeyFile,'utf8');
  const start = currentJourney.indexOf('| # | When |');
  const end = currentJourney.indexOf('\n\n', start);
  requireField(start >= 0 && end > start, 'Journey table not found');
  const table = ['| # | When | What the player gets | Judged by | 2026-11-14, reel at 15ef23e8 (desktop / phone) |','|---|---|---|---|---|',...release.criteria.map(r=>`| ${[r.id,r.context,r.requirement,r.judge,r.status_detail].join(' | ')} |`)].join('\n');
  const journey = currentJourney.slice(0,start) + table + currentJourney.slice(end);
  if (process.argv.includes('--check')) {
    requireField(fs.readFileSync(journeyFile,'utf8') === journey, 'journey.md is out of date; run pnpm plan:build and commit it');
    console.log('Plan schema and journey freshness OK');
  } else {
    fs.writeFileSync(journeyFile,journey);
    const sha = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    const builtAt = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date()) + ' JST';
    const output = path.join(root,'deploy/cloudflare-pages/dist/plan');
    fs.mkdirSync(output,{recursive:true});
    fs.writeFileSync(path.join(output,'index.html'),render(plan,sha,builtAt));
    console.log(`Built /plan and journey.md: RELEASE ${count(release.criteria)} PASS · ${sha.slice(0,8)} · ${builtAt}`);
  }
}
