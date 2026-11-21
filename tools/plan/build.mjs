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
  requireField(plan.version === 1 && text(plan.title), 'Plan needs version: 1 and title');
  requireField(Array.isArray(plan.decisions) && Array.isArray(plan.workstreams), 'Plan needs decisions and workstreams');
  const ids = new Set();
  const unique = (id) => {
    requireField(text(id) && !ids.has(id), `Missing or duplicate id: ${id}`);
    ids.add(id);
  };
  for (const decision of plan.decisions) {
    unique(decision.id);
    requireField(/^DEC-\d+$/.test(decision.id), 'Decision id must be DEC-n');
    requireField(['question', 'recommendation', 'blocks'].every(key => text(decision[key])) && date(decision.asked), `${decision.id}: question, recommendation, blocks and zoned date asked required`);
    requireField(Array.isArray(decision.options) && decision.options.length >= 2 && decision.options.every(text), `${decision.id}: at least two options required`);
    requireField(decision.options.includes(decision.recommendation), `${decision.id}: recommendation must be an option`);
    requireField(decision.answer == null || decision.options.includes(decision.answer), `${decision.id}: answer must be an option`);
  }
  for (const stream of plan.workstreams) {
    unique(stream.id);
    requireField(['title', 'goal', 'lead', 'next_step'].every(key => text(stream[key])), `${stream.id}: title, goal, lead and next_step required`);
    requireField(Array.isArray(stream.phases) && stream.phases.every(p => text(p.id) && text(p.title)) && stream.phases.some(p => p.id === stream.current_phase), `${stream.id}: phases and current_phase required`);
    requireField(Array.isArray(stream.open_prs) && stream.open_prs.every(p => text(p.label) && link(p.url)), `${stream.id}: open_prs must contain labelled links`);
    requireField(Array.isArray(stream.criteria), `${stream.id}: criteria required`);
    for (const row of stream.criteria) {
      unique(row.id);
      requireField(text(row.requirement) && statuses.includes(row.status), `${row.id}: requirement and valid status required`);
      if (stream.id === 'RELEASE') requireField(text(row.status_text) && row.status_text.toUpperCase().startsWith(row.status), `${row.id}: journey status_text must agree with status`);
      requireField(Array.isArray(row.evidence) && row.evidence.every(e => text(e.label) && link(e.url)), `${row.id}: evidence must contain labelled HTTPS links`);
      requireField(row.date == null || date(row.date), `${row.id}: date needs a timezone`);
      requireField(row.evidence.every(e => e.date == null || date(e.date)), `${row.id}: evidence dates need a timezone`);
      requireField(row.status !== 'PASS' || (text(row.judge) && date(row.date) && row.evidence.length > 0), `${row.id}: PASS needs a judge, a date and at least one evidence link. A merged PR or green CI alone is never PASS.`);
    }
  }
  requireField(plan.journey?.columns?.length === 5 && text(plan.journey.before_table) && text(plan.journey.after_table), 'Journey prose and five table columns required');
  return plan;
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const anchor = (label, url) => `<a href="${escape(url)}">${escape(label)}</a>`;
const count = rows => `${rows.filter(row => row.status === 'PASS').length} / ${rows.length}`;

function render(plan, sha, builtAt) {
  const waiting = plan.decisions.filter(d => d.answer == null);
  const decisions = waiting.length ? `<section aria-labelledby="waiting"><h2 id="waiting">Waiting for the Owner</h2><p>Reply in your chat: DEC-n: &lt;option&gt;. Leads record your answer in the plan.</p>${waiting.map(d => `<article class="decision"><h3>${escape(d.id)} · ${escape(d.question)}</h3><ul>${d.options.map(o => `<li>${escape(o)}</li>`).join('')}</ul><p><strong>Lead recommendation:</strong> ${escape(d.recommendation)}</p><p><strong>Blocks:</strong> ${escape(d.blocks)}</p><p>Asked ${escape(d.asked)}</p></article>`).join('')}</section>` : '';
  const streams = plan.workstreams.map(s => `<section id="${escape(s.id)}" aria-labelledby="title-${escape(s.id)}">
    <h2 id="title-${escape(s.id)}">${escape(s.id)} · ${escape(s.title)}</h2><p class="goal">${escape(s.goal)}</p>
    <ol class="phases">${s.phases.map(p => `<li${p.id === s.current_phase ? ' aria-current="step"' : ''}>${escape(p.title)}${p.id === s.current_phase ? ' <strong>← Current</strong>' : ''}</li>`).join('')}</ol>
    <p><strong>${count(s.criteria)} criteria PASS</strong></p><ul>${s.open_prs.map(p => `<li>${anchor(p.label,p.url)}</li>`).join('')}</ul>
    ${(s.notes ?? []).map(n => `<p class="note">${escape(n)}</p>`).join('')}
    ${(s.sources ?? []).map(p => `<p>${anchor(p.label,p.url)}</p>`).join('')}
    ${(s.rulings ?? []).length ? `<h3>Lead rulings</h3><ul>${s.rulings.map(r => `<li>${anchor(r.text,r.url)}</li>`).join('')}</ul>` : ''}
    <table><caption>Acceptance · ${escape(s.id)}</caption><thead><tr><th scope="col">Criterion</th><th scope="col">Requirement</th><th scope="col">Judged by</th><th scope="col">Status</th><th scope="col">Evidence</th></tr></thead><tbody>${s.criteria.map(r => `<tr id="${escape(r.id)}">
      <th scope="row">${escape(r.id)}</th><td data-label="Requirement">${r.when ? `<small>${escape(r.when)}</small>` : ''}<div class="requirement">${escape(r.requirement)}</div>${r.detail_url ? anchor('Full contract',r.detail_url) : ''}</td>
      <td data-label="Judged by">${escape(r.judge || 'Not recorded')}<small>${escape(r.date || 'Date not recorded')}</small></td>
      <td data-label="Status"><strong class="status ${r.status.toLowerCase().replaceAll(' ','-')}">${escape(r.status)}</strong>${r.status_text ? `<details><summary>Original judgement</summary><p>${escape(r.status_text)}</p></details>` : ''}</td>
      <td data-label="Evidence">${r.evidence.length ? `<ul>${r.evidence.map(e => `<li>${anchor(e.label,e.url)}<small>SHA: ${escape(e.sha || 'not recorded')} · ${escape(e.date || 'Date not recorded')}</small></li>`).join('')}</ul>` : 'No evidence recorded'}</td>
    </tr>`).join('')}</tbody></table>
    <p><strong>Next step:</strong> ${escape(s.next_step)}</p><p><strong>Owning lead:</strong> ${escape(s.lead)}</p></section>`).join('');
  const values = {title:escape(plan.title),sha:escape(sha.slice(0,8)),builtAt:escape(builtAt),progress:count(plan.workstreams.flatMap(s=>s.criteria)),decisions,streams,nav:plan.workstreams.map(s=>anchor(s.id,`#${s.id}`)).join(' · ')};
  return fs.readFileSync(path.join(root,'tools/plan/page.html'),'utf8').replace(/\{\{(\w+)\}\}/g,(_,key)=>values[key]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const plan = validatePlan(parse(fs.readFileSync(path.join(root,'docs/release/plan.yaml'),'utf8')));
  const release = plan.workstreams.find(s => s.id === 'RELEASE');
  const table = [`| ${plan.journey.columns.join(' | ')} |`,plan.journey.separator,...release.criteria.map(r=>`| ${[r.id,r.when,r.requirement,r.judge,r.status_text].join(' | ')} |`)].join('\n');
  const journey = plan.journey.before_table + table + plan.journey.after_table;
  const journeyFile = path.join(root,'docs/release/journey.md');
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
