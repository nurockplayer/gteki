<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: GTEki contributors -->
# Merchant intake

Check a shop's submission file against the station bundle, consent, identity domain, rate, duplicate and claim rules, floor and anchor, content and hours age. Accepted reports include a proposed source and POI; they do not change station files. Exceptions require a person to decide.

```sh
MERCHANT_INTAKE_KEY=... pnpm intake check submission.json --queue /path/to/private/queue --now 2026-11-10T00:00:00Z
MERCHANT_INTAKE_KEY=... pnpm intake check submission.json --queue /path/to/private/queue --write
pnpm intake prune --queue /path/to/private/queue --dry-run
pnpm intake prune --queue /path/to/private/queue
```

Keep the queue, key, and submissions containing contacts in gteki-private, never in this public repository. `--write` reserves the source id in the queue. `--write` stores the submission and its keyed identity only in the private queue. Open exceptions are retained; closed exceptions use `closedAt` for the 90-day retention clock.
