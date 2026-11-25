// Verify the built docs/index.html against content/hunt.yaml:
// plays every team through, checks wrong answers, team separation,
// decoys, and that no secret appears in plain text in the page.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { openLock, decryptJson, decodeText, toHex, fromHex, normalize, TROLL_PREFIX } from '../src/crypto.js';
import { loadContent, planTeams, allDecoys, allEggs, validateContent } from './lib.js';

process.chdir(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'));

const content = await loadContent();
const { warnings } = validateContent(content);
const plans = planTeams(content);
const html = await readFile('docs/index.html', 'utf8');
const dataMatch = html.match(/<script id="hunt-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!dataMatch) throw new Error('hunt-data not found in docs/index.html – run npm run build');
const data = JSON.parse(dataMatch[1]);
const ITER = data.iterations;

let checks = 0;
let failures = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.error('✖  ' + msg);
  }
}
const section = (s) => console.log(`\n— ${s}`);

// ---------- 1. play-through ----------

section('Playing through every team with every accepted answer');
for (const plan of plans) {
  const team = data.teams.find((t) => t.id === plan.id);
  ok(team, `team ${plan.id} missing in build – rebuild?`);
  if (!team) continue;
  ok(team.steps.length === plan.steps.length, `${plan.name}: step count differs – rebuild?`);

  ok(team.locks[0] === null && team.startKey, `${plan.name}: first step should be open (startKey, no lock)`);
  let prev = '';
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const lock = team.locks[i];
    let key = i === 0 ? fromHex(team.startKey) : null;

    for (const answer of step.unlockAnswers) {
      const raw = await openLock(lock, prev, answer, ITER);
      ok(raw, `${plan.name} step ${i + 1}: "${answer}" should unlock`);
      if (raw && key) ok(toHex(raw) === toHex(key), `${plan.name} step ${i + 1}: variants yield different keys`);
      key = key || raw;
    }

    const accepted = new Set(step.unlockAnswers.map(normalize));
    const wrong = ['wrong answer', ...(plan.steps[i + 1]?.unlockAnswers || [])]
      .filter((w) => !accepted.has(normalize(w)))
      .slice(0, 3);
    for (const w of lock ? wrong : []) {
      ok(!(await openLock(lock, prev, w, ITER)), `${plan.name} step ${i + 1}: "${w}" must NOT unlock`);
    }

    if (!key) break;
    const payload = await decryptJson(key, team.steps[i]);
    ok(
      payload.kind === step.payload.kind && payload.title === step.payload.title,
      `${plan.name} step ${i + 1}: decrypted payload does not match content`
    );
    prev = toHex(key);
  }
  console.log(`   ${plan.name}: ${plan.steps.length} steps checked`);
}

// ---------- 2. team separation ----------

section('Team separation');
for (const a of plans) {
  const teamA = data.teams.find((t) => t.id === a.id);
  const firstAnswer = a.steps[0].answersOut[0];
  for (const b of data.teams) {
    if (b.id === a.id) continue;
    // a team's start key must not open another team's second step, even with the right answer
    ok(!(await openLock(b.locks[1], teamA.startKey, firstAnswer, ITER)), `${a.name}'s start key opens team ${b.id}`);
  }
}
console.log('   start keys only work for their own team');

// ---------- 3. decoys ----------

section('Decoys');
const decoys = allDecoys(content);
const trollMessages = content.decoys?.trollMessages || [];
for (const d of decoys) {
  const raw = data.troll && (await openLock(data.troll, TROLL_PREFIX, d, ITER));
  ok(raw && trollMessages.includes(decodeText(raw)), `decoy "${d}" does not trigger a troll message`);
}
for (const d of decoys.slice(0, 3)) {
  for (const team of data.teams) {
    ok(!(await openLock(team.locks[1], team.startKey, d, ITER)), `decoy "${d}" opens team ${team.id}`);
  }
}
const backupMatch = html.match(/__SOLUTIONS_BACKUP__ = "([^"]*)"/);
const backup = backupMatch ? Buffer.from(backupMatch[1], 'base64').toString('utf8') : '';
for (const d of decoys) {
  ok(html.includes(d) || backup.includes(d), `decoy "${d}" is not visible in the page source`);
}
console.log(`   ${decoys.length} decoys planted, all trigger a troll message`);

const eggs = allEggs(content);
for (const { answer, message } of eggs) {
  const raw = data.troll && (await openLock(data.troll, TROLL_PREFIX, answer, ITER));
  ok(raw && decodeText(raw) === message, `egg "${answer}" does not show its message`);
  for (const team of data.teams) {
    ok(!(await openLock(team.locks[1], team.startKey, answer, ITER)), `egg "${answer}" opens team ${team.id}`);
  }
}
if (eggs.length) console.log(`   ${eggs.length} easter-egg answers, all show their message`);

// ---------- 4. leak check ----------

section('Leak check (no secrets in plain text)');
const lower = html.toLowerCase();
const decoySet = new Set(decoys.map(normalize));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function leaked(needle) {
  const n = String(needle).toLowerCase().trim();
  if (n.length < 3 || decoySet.has(normalize(n))) return false;
  return new RegExp(`(?<![a-z0-9])${escapeRe(n)}(?![a-z0-9])`).test(lower);
}
const secrets = [];
for (const plan of plans) {
  for (const step of plan.steps) {
    step.answersOut.forEach((a) => secrets.push(['answer', a]));
    step.hints.forEach((x) => secrets.push(['hint', x]));
    if (step.payload.kind !== 'finale') {
      secrets.push(['riddle title', step.payload.title]);
      secrets.push(['riddle text', String(step.payload.text).trim().split('\n')[0].slice(0, 40)]);
    }
  }
}
for (const st of Object.values(content.stations)) if (st.name) secrets.push(['station name', st.name]);
secrets.push(['secret', content.secret]);
const seen = new Set();
for (const [kind, s] of secrets) {
  if (seen.has(s)) continue;
  seen.add(s);
  ok(!leaked(s), `${kind} "${s}" appears in plain text in docs/index.html`);
}
console.log(`   ${seen.size} secret strings searched`);

// ---------- summary ----------

if (warnings.length) {
  console.log('\nWarnings:');
  warnings.forEach((w) => console.warn('⚠  ' + w));
}
console.log(`\n${checks} checks, ${failures} failed.`);
if (failures) {
  console.error('✖  Verification FAILED');
  process.exit(1);
}
console.log('✔  All checks passed');
