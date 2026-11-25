// Shared by build.js and verify.js: load + validate content, plan every team's steps.
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import YAML from 'yaml';
import { normalize, SLOT_COUNT } from '../src/crypto.js';
import { roman } from '../src/text.js';

export const CONTENT_FILE = 'content/hunt.yaml';

export async function loadContent(file = CONTENT_FILE) {
  return YAML.parse(await readFile(file, 'utf8'));
}

// ---------- deterministic secrets (stable across rebuilds) ----------

/** Content key of a step. Deterministic, so redeploying keeps players' progress valid. */
export function contentKey(secret, teamId, stepIndex) {
  return new Uint8Array(createHmac('sha256', secret).update(`content|${teamId}|${stepIndex}`).digest());
}

// ---------- decoys ----------

export function allDecoys(content) {
  const d = content.decoys || {};
  const out = [];
  for (const group of [d.todoComment, d.devAnswers]) {
    for (const list of Object.values(group || {})) out.push(...list);
  }
  out.push(...(d.encodedBackup || []));
  if (d.hiddenAttribute) out.push(d.hiddenAttribute);
  return out;
}

/**
 * Easter eggs: secret answers (not planted in the source) that show a special
 * message on any input field. Returns [{ answer, message }], messages rotated per group.
 */
export function allEggs(content) {
  const out = [];
  for (const egg of content.eggs || []) {
    const messages = egg.messages || [];
    (egg.answers || []).forEach((answer, i) => {
      if (messages.length) out.push({ answer, message: messages[i % messages.length] });
    });
  }
  return out;
}

// ---------- planning ----------

/** Letters a station hands out (e.g. "TÄ" → ["T", "Ä"]), for the meeting-place anagram. Umlauts are kept for display. */
export function stationLetters(st) {
  return [...String(st.letters || '').toUpperCase().replace(/[^\p{L}]/gu, '')];
}

/**
 * Turns the content into a linear list of steps per team.
 * step = {
 *   payload,          // what gets encrypted (image added by build)
 *   image,            // { path, transform } or null
 *   unlockAnswers,    // answers that open the lock leading TO this step
 *   answersOut,       // answers typed ON this step (unlock the next one)
 *   hints, stationId, part
 * }
 */
export function planTeams(content) {
  const meta = content.meta || {};
  return content.teams.map((team) => {
    const route = team.route;
    const stationCount = route.length;
    const steps = [];

    route.forEach((stationId, k) => {
      const st = content.stations[stationId];
      const station = k + 1;
      const r = st.riddle;
      const hints = st.hints || {};
      const image = r.image ? { path: r.image, transform: r.transform || {} } : null;
      const onSiteImage = st.onSite?.image ? { path: st.onSite.image, transform: st.onSite.transform || {} } : null;

      if (st.locationCheck) {
        steps.push({
          stationId,
          part: 'riddle',
          image,
          hints: hints.location || [],
          answersOut: st.locationCheck.answers,
          payload: {
            kind: 'riddle',
            station,
            stationCount,
            title: r.title,
            text: r.text,
            prompt: st.locationCheck.prompt || 'Where do you need to go?',
            success: st.locationCheck.success || 'Correct! Head there.',
            about: st.locationCheck.about || '',
            completesStation: false,
          },
        });
        steps.push({
          stationId,
          part: 'onsite',
          image: onSiteImage,
          hints: hints.onSite || [],
          answersOut: st.onSite.answers,
          payload: {
            kind: 'onsite',
            station,
            stationCount,
            title: st.onSite.title || 'On site',
            text: st.onSite.question,
            prompt: st.onSite.prompt || 'Your answer',
            completesStation: true,
            photoReminder: meta.photoReminder,
            letters: stationLetters(st),
          },
        });
      } else {
        steps.push({
          stationId,
          part: 'combined',
          image: image || onSiteImage,
          hints: [...(hints.location || []), ...(hints.onSite || [])],
          answersOut: st.onSite.answers,
          payload: {
            kind: 'riddle',
            station,
            stationCount,
            title: r.title,
            text: r.text,
            question: st.onSite.question,
            prompt: st.onSite.prompt || 'Your answer',
            completesStation: true,
            photoReminder: meta.photoReminder,
            letters: stationLetters(st),
          },
        });
      }
    });

    const mp = content.meetingPlace;
    if (mp) {
      steps.push({
        stationId: null,
        part: 'place',
        image: null,
        hints: mp.hints || [],
        answersOut: mp.answers,
        payload: {
          kind: 'place',
          stationCount,
          title: mp.title || 'Where we meet again',
          text: mp.text,
          prompt: mp.prompt || 'Where do we meet?',
        },
      });
    }

    steps.push({
      stationId: null,
      part: 'finale',
      image: null,
      hints: [],
      answersOut: [],
      payload: {
        kind: 'finale',
        stationCount,
        title: meta.finaleTitle || 'You made it!',
        text: meta.finale || '',
      },
    });

    steps.forEach((step, i) => {
      // Step 0 has no lock: its key is published (teams just pick their team, no start code).
      // No skip codes: a stuck team gets the answer from the game masters and types it in.
      step.unlockAnswers = i === 0 ? [] : [...steps[i - 1].answersOut];
    });

    return {
      id: team.id,
      name: team.name,
      numeral: roman(team.id),
      route,
      steps,
    };
  });
}

// ---------- validation ----------

export function validateContent(content) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!content || typeof content !== 'object') return { errors: ['content file is empty'], warnings };
  if (!content.secret || String(content.secret).length < 16) err('`secret` must be set (at least 16 characters).');
  if (!Array.isArray(content.teams) || content.teams.length === 0) err('No teams defined.');
  if (!content.stations || typeof content.stations !== 'object') err('No stations defined.');
  if (errors.length) return { errors, warnings };

  const realAnswers = new Map(); // normalized -> where
  const addReal = (a, where) => {
    const n = normalize(a);
    if (!n) return err(`Empty answer in ${where}.`);
    if (/^\d+$/.test(n)) warn(`Answer "${a}" in ${where} is only digits – guessable by hand.`);
    else if (n.length < 4) warn(`Answer "${a}" in ${where} is very short – guessable by hand.`);
    if (!realAnswers.has(n)) realAnswers.set(n, where);
  };

  // stations
  for (const [id, st] of Object.entries(content.stations)) {
    const w = `station "${id}"`;
    if (!st.riddle?.title || !st.riddle?.text) err(`${w}: riddle.title and riddle.text are required.`);
    if (!st.solution?.location?.length) warn(`${w}: no solution.location steps for the game masters' guide.`);
    if (!st.onSite?.question) err(`${w}: onSite.question is required.`);
    if (!Array.isArray(st.onSite?.answers) || st.onSite.answers.length === 0) err(`${w}: onSite.answers is required.`);
    else {
      if (new Set(st.onSite.answers.map(normalize)).size > SLOT_COUNT)
        err(`${w}: at most ${SLOT_COUNT} distinct onSite answers.`);
      st.onSite.answers.forEach((a) => addReal(a, `${w} onSite`));
    }
    if (st.locationCheck) {
      const a = st.locationCheck.answers;
      if (!Array.isArray(a) || a.length === 0) err(`${w}: locationCheck.answers is required.`);
      else {
        if (new Set(a.map(normalize)).size > SLOT_COUNT)
          err(`${w}: at most ${SLOT_COUNT} distinct locationCheck answers.`);
        a.forEach((x) => addReal(x, `${w} locationCheck`));
      }
    }
  }

  // teams
  const ids = new Set();
  const used = new Set();
  for (const t of content.teams) {
    const w = `team ${t.id}`;
    if (ids.has(t.id)) err(`Duplicate team id ${t.id}.`);
    ids.add(t.id);
    if (!t.name) err(`${w}: name is required.`);
    if (t.startCode) warn(`${w}: startCode is no longer used – remove it.`);
    if (!Array.isArray(t.route) || t.route.length === 0) err(`${w}: route is empty.`);
    for (const s of t.route || []) {
      if (!content.stations[s]) err(`${w}: unknown station "${s}" in route.`);
      used.add(s);
    }
    if (new Set(t.route).size !== (t.route || []).length) warn(`${w}: a station appears twice in the route.`);
  }
  for (const id of Object.keys(content.stations)) {
    if (!used.has(id)) warn(`Station "${id}" is not used by any team.`);
  }

  // meeting place: answers + the station letters must be an anagram of its name
  const mp = content.meetingPlace;
  if (mp) {
    if (!mp.text) err('meetingPlace.text is required.');
    if (!Array.isArray(mp.answers) || !mp.answers.length) err('meetingPlace.answers is required.');
    else {
      if (new Set(mp.answers.map(normalize)).size > SLOT_COUNT) err(`meetingPlace: at most ${SLOT_COUNT} distinct answers.`);
      mp.answers.forEach((a) => addReal(a, 'meetingPlace'));
      const target = normalize(mp.answers[0]).replace(/[0-9]/g, '').toUpperCase().split('').sort().join('');
      for (const t of content.teams) {
        const got = (t.route || [])
          .flatMap((id) => (content.stations[id] ? stationLetters(content.stations[id]) : []))
          .map((l) => normalize(l).toUpperCase()) // Ä counts as A, like typed answers
          .sort()
          .join('');
        if (got !== target)
          err(`team ${t.id}: station letters "${got}" are not an anagram of "${mp.answers[0]}" ("${target}").`);
      }
    }
  }

  // decoys
  const d = content.decoys || {};
  if (!d.trollMessages || d.trollMessages.length === 0) warn('No decoys.trollMessages defined.');
  for (const decoy of allDecoys(content)) {
    const n = normalize(decoy);
    if (realAnswers.has(n)) err(`Decoy "${decoy}" equals a real answer (${realAnswers.get(n)}).`);
  }

  // easter eggs
  const trollSeen = new Set(allDecoys(content).map(normalize));
  for (const egg of content.eggs || []) {
    if (!egg.answers?.length || !egg.messages?.length) err('Each entry in `eggs` needs answers and messages.');
  }
  for (const { answer } of allEggs(content)) {
    const n = normalize(answer);
    if (realAnswers.has(n)) err(`Egg "${answer}" equals a real answer (${realAnswers.get(n)}).`);
    if (trollSeen.has(n)) err(`Egg "${answer}" is listed twice (or also as a decoy).`);
    trollSeen.add(n);
  }

  return { errors, warnings };
}
