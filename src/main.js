// The Riga Hunt – browser app.
// Shows the current riddle, checks answers by trying to decrypt the next step,
// keeps progress + side quests in localStorage. Nothing else.
import { openLock, decryptJson, decodeText, toHex, fromHex, hasWebCrypto, TROLL_PREFIX } from './crypto.js';
import { mdToHtml, roman } from './text.js';

const STORAGE_KEY = 'rigaHunt.v1';
const data = JSON.parse(document.getElementById('hunt-data').textContent);
const app = document.getElementById('app');
const ITER = data.iterations;

// ---------------------------------------------------------------------------
// Icons & ornaments (static markup)
// ---------------------------------------------------------------------------

const S = 'fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const C = 'stroke="currentColor"';
const ICON = {
  menu: `<svg width="22" height="22" viewBox="0 0 24 24" ${S} ${C} stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>`,
  chevron: `<svg width="20" height="20" viewBox="0 0 24 24" ${S} stroke="#C9A24A" stroke-width="2"><polyline points="9 6 15 12 9 18"/></svg>`,
  back: `<svg width="18" height="18" viewBox="0 0 24 24" ${S} ${C} stroke-width="2"><polyline points="15 6 9 12 15 18"/></svg>`,
  quests: `<svg width="17" height="17" viewBox="0 0 24 24" ${S} stroke="#C9A24A" stroke-width="2"><path d="M10 6h10M10 12h10M10 18h10"/><polyline points="3 6 4.5 7.5 7 5"/><polyline points="3 12 4.5 13.5 7 11"/><circle cx="5" cy="18" r="1.5"/></svg>`,
  zoom: `<svg width="17" height="17" viewBox="0 0 24 24" ${S} ${C} stroke-width="2.2"><circle cx="11" cy="11" r="6"/><line x1="20" y1="20" x2="15.5" y2="15.5"/></svg>`,
  close: `<svg width="20" height="20" viewBox="0 0 24 24" ${S} ${C} stroke-width="2.2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`,
  camera: `<svg width="24" height="24" viewBox="0 0 24 24" ${S} stroke="#C9A24A" stroke-width="1.8"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
};

const SUN_RAYS = `
  <path d="M141 296 A26 26 0 0 1 193 296 Z" fill="#C9A24A"/>
  <g class="sun-rays" stroke="#C9A24A" stroke-width="1.5" stroke-linecap="round">
    <line x1="199" y1="284.4" x2="221.5" y2="276.2"/><line x1="193" y1="274.1" x2="211.4" y2="258.7"/>
    <line x1="184" y1="266.6" x2="196" y2="245.8"/><line x1="172.9" y1="262.5" x2="177.1" y2="238.9"/>
    <line x1="161.1" y1="262.5" x2="156.9" y2="238.9"/><line x1="150" y1="266.6" x2="138" y2="245.8"/>
    <line x1="141" y1="274.1" x2="122.6" y2="258.7"/><line x1="135" y1="284.4" x2="112.5" y2="276.2"/>
  </g>`;

const ARCH_SVG = `
<svg viewBox="0 0 334 300" fill="none" aria-hidden="true">
  <path d="M20 300 V150 A147 147 0 0 1 314 150 V300" stroke="#C9A24A" stroke-width="2"/>
  <path d="M36 300 V150 A131 131 0 0 1 298 150 V300" stroke="#C9A24A" stroke-width="1" stroke-opacity="0.55"/>
  <path d="M167 28 L173 34 L167 40 L161 34 Z" fill="#C9A24A"/>
  <path d="M52 300 C52 240 82 222 70 172" stroke="#C9A24A" stroke-width="1.5"/>
  <circle cx="70" cy="167" r="4" fill="#C9A24A"/>
  <path d="M62 250 C48 244 44 230 50 222 C58 232 62 240 62 250 Z" fill="#C9A24A" fill-opacity="0.7"/>
  <path d="M282 300 C282 240 252 222 264 172" stroke="#C9A24A" stroke-width="1.5"/>
  <circle cx="264" cy="167" r="4" fill="#C9A24A"/>
  <path d="M272 250 C286 244 290 230 284 222 C276 232 272 240 272 250 Z" fill="#C9A24A" fill-opacity="0.7"/>
  ${SUN_RAYS}
</svg>`;

const CARD_ORNAMENT = `
<svg width="130" height="46" viewBox="102 236 130 62" fill="none" aria-hidden="true">${SUN_RAYS}
  <line x1="102" y1="296" x2="232" y2="296" stroke="#C9A24A" stroke-width="1" stroke-opacity="0.6"/>
</svg>`;

const CONSOLE_EGG = `
   /\\_/\\
  ( o.o )   Looking for the answers in here?
   > ^ <    They're outside. Go find them.

   P.S. Mona says hi. She knows you're peeking.
`;

// ---------------------------------------------------------------------------
// Tiny DOM helpers
// ---------------------------------------------------------------------------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}

function show(node) {
  closeOverlays();
  app.replaceChildren(node);
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

let state = loadState();
if (!state.quests) state.quests = {};

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // private mode etc. – progress just won't survive a reload
  }
}

const teamById = (id) => data.teams.find((t) => t.id === id);
const questsDone = () => data.sidequests.filter((q) => state.quests[q.id]).length;

function refreshQuestCounts() {
  const text = `${questsDone()}/${data.sidequests.length}`;
  document.querySelectorAll('.js-quest-count').forEach((el) => (el.textContent = text));
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function archHero({ kicker, lines, small } = {}) {
  return h(
    'div',
    { class: 'arch-hero' + (small ? ' arch-hero--small' : '') },
    svg(ARCH_SVG),
    kicker || lines
      ? h(
          'div',
          { class: 'arch-hero__text' },
          kicker ? h('span', { class: 'kicker' }, kicker) : null,
          lines ? h('h1', null, lines.flatMap((l, i) => (i ? [h('br'), l] : [l]))) : null
        )
      : null
  );
}

function titleLines(title) {
  // "The Riga Hunt" → "The Riga" / "Hunt"; short endings ("You made it!") stay on one line.
  const words = String(title).split(' ');
  const last = words[words.length - 1];
  return words.length > 2 && last.length >= 4 ? [words.slice(0, -1).join(' '), last] : [title];
}

function questButton(extraClass = '') {
  return h(
    'button',
    { type: 'button', class: 'btn-outline ' + extraClass, onClick: openQuests },
    svg(ICON.quests),
    'Side quests ',
    h('span', { class: 'js-quest-count' }, `${questsDone()}/${data.sidequests.length}`)
  );
}

function topbar(team) {
  return h(
    'header',
    { class: 'topbar' },
    h('span', { class: 'kicker' }, team.name),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Menu', onClick: () => openMenu(team) }, svg(ICON.menu))
  );
}

async function checkTroll(value) {
  if (!data.troll) return null;
  const raw = await openLock(data.troll, TROLL_PREFIX, value, ITER);
  return raw ? decodeText(raw) : null;
}

/** Generic answer form. onSubmit(value) resolves to true when the answer was right. */
function answerForm({ id, label, placeholder, button, onSubmit }) {
  let busy = false;
  const input = h('input', {
    id,
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
    placeholder,
  });
  const btn = h('button', { type: 'submit', class: 'btn-primary' }, button);
  const fb = h('p', { class: 'feedback', role: 'status', 'aria-live': 'polite' });

  const form = h(
    'form',
    {
      class: 'answer',
      onSubmit: async (e) => {
        e.preventDefault();
        const value = input.value;
        if (busy || !value.trim()) return;
        busy = true;
        btn.disabled = true;
        btn.textContent = 'Checking…';
        fb.textContent = '';
        fb.className = 'feedback';
        try {
          if (await onSubmit(value)) return; // screen has changed
          const troll = await checkTroll(value);
          if (troll) {
            fb.textContent = troll;
            fb.className = 'feedback feedback--troll';
            input.value = '';
          } else {
            fb.textContent = 'Not quite. Check your spelling – or ask the game masters for a hint.';
            fb.className = 'feedback feedback--error';
            input.classList.remove('shake');
            void input.offsetWidth; // restart animation
            input.classList.add('shake');
          }
        } catch (err) {
          console.error(err);
          fb.textContent = 'Something went wrong. Please try again.';
          fb.className = 'feedback feedback--error';
        } finally {
          busy = false;
          btn.disabled = false;
          btn.textContent = button;
        }
      },
    },
    h('label', { for: id }, label),
    input,
    btn,
    fb
  );
  return form;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function renderWelcome(notice) {
  show(
    h(
      'main',
      { class: 'screen' },
      archHero({ kicker: data.kicker, lines: titleLines(data.title) }),
      notice ? h('div', { class: 'notice', role: 'status' }, notice) : null,
      h('p', { class: 'lead' }, data.intro),
      data.photoRule ? h('div', { class: 'notice' }, svg(ICON.camera), h('span', null, data.photoRule)) : null,
      h('div', { class: 'rule' }, h('span', { class: 'kicker' }, 'Choose your team')),
      h(
        'div',
        { class: 'team-list' },
        data.teams.map((t) =>
          h(
            'button',
            { type: 'button', class: 'team-btn', onClick: () => renderStart(t) },
            h('span', { class: 'team-btn__num' }, t.numeral),
            h('span', { class: 'team-btn__name' }, t.name),
            svg(ICON.chevron)
          )
        )
      ),
      h(
        'button',
        { type: 'button', class: 'link-btn push-bottom', onClick: openQuests },
        svg(ICON.quests),
        'Side quests'
      )
    )
  );
}

function renderStart(team) {
  let busy = false;
  const begin = h(
    'button',
    {
      type: 'button',
      class: 'btn-primary',
      onClick: async () => {
        if (busy) return;
        busy = true;
        try {
          const payload = await decryptJson(fromHex(team.startKey), team.steps[0]);
          state = { teamId: team.id, stepIndex: 0, keyHex: team.startKey, quests: state.quests || {} };
          saveState();
          renderStep(team, payload);
        } catch (err) {
          console.error(err);
          busy = false;
        }
      },
    },
    'Begin the hunt',
    svg(ICON.chevron.replace('#C9A24A', 'currentColor'))
  );

  show(
    h(
      'main',
      { class: 'screen' },
      h('button', { type: 'button', class: 'link-btn link-btn--back', onClick: () => renderWelcome() }, svg(ICON.back), 'All teams'),
      archHero({ kicker: `Team ${team.numeral}`, lines: [team.name.replace(/^Team\s+/i, '')], small: true }),
      h('p', { class: 'lead' }, `You are playing as ${team.name}. All teams start at the same time – wait for the game masters’ signal.`),
      begin
    )
  );
}

function renderStep(team, payload) {
  if (payload.kind === 'finale') return renderFinale(team, payload);
  const i = state.stepIndex;
  const isPlace = payload.kind === 'place';
  const { stationCount } = payload;
  const station = isPlace ? stationCount + 1 : payload.station; // all windows lit on the final riddle

  const progress = h(
    'div',
    { class: 'progress', role: 'img', 'aria-label': `Station ${station} of ${stationCount}` },
    Array.from({ length: stationCount }, (_, k) => {
      const n = k + 1;
      const mod = n < station ? ' progress__win--done' : n === station ? ' progress__win--current' : '';
      return h('span', { class: 'progress__win' + mod });
    })
  );

  const figure = payload.image
    ? h(
        'figure',
        { class: 'figure' },
        h('img', { src: payload.image, alt: 'Riddle picture' }),
        h(
          'button',
          { type: 'button', class: 'figure__zoom', 'aria-label': 'Enlarge picture', onClick: () => openLightbox(payload.image) },
          svg(ICON.zoom)
        )
      )
    : h('div', { class: 'card-ornament' }, svg(CARD_ORNAMENT));

  const card = h(
    'article',
    { class: 'card card--arch' + (payload.image ? '' : ' card--no-image') },
    figure,
    h('span', { class: 'kicker' }, payload.kind === 'onsite' ? 'On site' : isPlace ? 'The last riddle' : 'The riddle'),
    h('h2', null, payload.title),
    h('div', { class: 'riddle-text', html: mdToHtml(payload.text) }),
    payload.question ? h('div', { class: 'riddle-question', html: mdToHtml(payload.question) }) : null
  );

  const form = answerForm({
    id: `answer-${i}`,
    label: payload.prompt,
    placeholder: 'Your answer',
    button: 'Check answer',
    onSubmit: async (value) => {
      const raw = await openLock(team.locks[i + 1], state.keyHex, value, ITER);
      if (!raw) return false;
      const next = await decryptJson(raw, team.steps[i + 1]);
      state.stepIndex = i + 1;
      state.keyHex = toHex(raw);
      saveState();
      if (isPlace) renderStep(team, next); // straight to the finale
      else renderSolved(team, payload, next);
      return true;
    },
  });

  show(
    h(
      'main',
      { class: 'screen' },
      topbar(team),
      h(
        'div',
        { class: 'station-head' },
        isPlace
          ? h('h1', null, 'All stations done')
          : h('h1', null, `Station ${roman(station)} `, h('span', null, `of ${roman(stationCount)}`)),
        progress
      ),
      card,
      form,
      h(
        'footer',
        { class: 'step-foot' },
        h('span', { class: 'step-foot__hint' }, data.hintText),
        questButton()
      )
    )
  );
}

function renderSolved(team, solved, next) {
  const stationDone = solved.completesStation;
  const title = stationDone ? `Station ${roman(solved.station)} solved!` : 'Correct!';
  const buttonText = stationDone
    ? next.kind === 'finale'
      ? 'To the finale'
      : next.kind === 'place'
        ? 'To the last riddle'
        : 'Next station'
    : 'We’re there';
  const letters = stationDone ? solved.letters || [] : [];

  show(
    h(
      'main',
      { class: 'screen' },
      topbar(team),
      archHero({ small: true }),
      h(
        'div',
        { class: 'center-col' },
        h('h1', null, title),
        letters.length
          ? h(
              'div',
              { class: 'letters' },
              h('p', { class: 'lead' }, letters.length > 1 ? 'You received the letters' : 'You received the letter'),
              h('div', { class: 'letters__row' }, letters.map((l) => h('span', { class: 'letter-tile' }, l))),
              h('p', { class: 'muted' }, letters.length > 1 ? 'Remember them – you’ll need them later!' : 'Remember it – you’ll need it later!')
            )
          : null,
        stationDone
          ? solved.photoReminder
            ? h('div', { class: 'notice' }, svg(ICON.camera), h('span', null, solved.photoReminder))
            : null
          : h('p', { class: 'lead' }, solved.success)
      ),
      !stationDone && solved.about
        ? h(
            'article',
            { class: 'card about' },
            h('span', { class: 'kicker' }, 'About this place'),
            h('div', { class: 'riddle-text', html: mdToHtml(solved.about) })
          )
        : null,
      h(
        'button',
        { type: 'button', class: 'btn-primary push-bottom', onClick: () => renderStep(team, next) },
        buttonText,
        svg(ICON.chevron.replace('#C9A24A', 'currentColor'))
      )
    )
  );
}

function renderFinale(team, payload) {
  show(
    h(
      'main',
      { class: 'screen' },
      topbar(team),
      archHero({ kicker: team.name, lines: titleLines(payload.title) }),
      h('div', { class: 'riddle-text', style: 'text-align:center', html: mdToHtml(payload.text) }),
      h(
        'div',
        { class: 'center-col push-bottom' },
        h('p', { class: 'muted' }, 'Side quests completed: ', h('span', { class: 'js-quest-count' }, `${questsDone()}/${data.sidequests.length}`)),
        questButton()
      )
    )
  );
}

function renderError(message) {
  show(
    h(
      'main',
      { class: 'screen' },
      archHero({ kicker: data.kicker, lines: titleLines(data.title) }),
      h('div', { class: 'notice', role: 'alert' }, message)
    )
  );
}

// ---------------------------------------------------------------------------
// Overlays: sheets & lightbox
// ---------------------------------------------------------------------------

let overlayCleanup = [];

function closeOverlays() {
  overlayCleanup.forEach((fn) => fn());
  overlayCleanup = [];
}

function openOverlay(el, focusEl) {
  closeOverlays();
  const prevFocus = document.activeElement;
  const onKey = (e) => e.key === 'Escape' && closeOverlays();
  document.addEventListener('keydown', onKey);
  document.body.append(el);
  document.body.style.overflow = 'hidden';
  overlayCleanup.push(() => {
    el.remove();
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  });
  (focusEl || el).focus?.();
}

function openSheet(title, ...content) {
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onClick: closeOverlays }, svg(ICON.close));
  const sheet = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet__head' }, h('h2', null, title), closeBtn),
    ...content
  );
  const backdrop = h('div', { class: 'sheet-backdrop', onClick: (e) => e.target === backdrop && closeOverlays() }, sheet);
  openOverlay(backdrop, closeBtn);
}

function openQuests() {
  const items = data.sidequests.map((q) => {
    const box = h('input', {
      type: 'checkbox',
      checked: !!state.quests[q.id],
      onChange: () => {
        if (box.checked) state.quests[q.id] = true;
        else delete state.quests[q.id];
        row.classList.toggle('quest--done', box.checked);
        saveState();
        refreshQuestCounts();
      },
    });
    const row = h('label', { class: 'quest' + (state.quests[q.id] ? ' quest--done' : '') }, box, h('span', null, q.text));
    return row;
  });
  openSheet(
    'Side quests',
    h('p', { class: 'sheet__intro' }, 'Complete them along the way and take a photo of each as proof. The game masters check your photos afterwards.'),
    ...items
  );
}

function openMenu(team) {
  let armed = false;
  const reset = h(
    'button',
    {
      type: 'button',
      class: 'danger-btn',
      onClick: () => {
        if (!armed) {
          armed = true;
          reset.textContent = 'Tap again to confirm – progress on this phone will be lost';
          return;
        }
        state = { quests: state.quests };
        saveState();
        renderWelcome();
      },
    },
    'Switch team / reset progress'
  );
  openSheet(
    'Menu',
    h('p', { class: 'sheet__intro' }, `You are playing as ${team.name}.`),
    questButton(),
    reset
  );
}

function openLightbox(src) {
  const img = h('img', { src, alt: 'Riddle picture, enlarged' });
  const closeBtn = h('button', { type: 'button', class: 'lightbox__close', 'aria-label': 'Close', onClick: closeOverlays }, svg(ICON.close));
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Picture' }, img, closeBtn);
  img.addEventListener('click', () => box.classList.toggle('lightbox--zoomed'));
  openOverlay(box, closeBtn);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  console.log('%c' + CONSOLE_EGG, 'font-family: monospace; color: #C9A24A');
  if (!hasWebCrypto()) {
    renderError('This page needs a secure connection. Please open it via its https:// link.');
    return;
  }
  const team = teamById(state.teamId);
  if (team && typeof state.stepIndex === 'number' && state.keyHex && team.steps[state.stepIndex]) {
    try {
      const payload = await decryptJson(fromHex(state.keyHex), team.steps[state.stepIndex]);
      renderStep(team, payload);
      return;
    } catch (err) {
      console.warn('Stored progress is no longer valid', err);
      state = { quests: state.quests };
      saveState();
      renderWelcome('The hunt was updated and your progress could not be restored. Pick your team again and re-enter your answers – the game masters can tell you any you’ve forgotten.');
      return;
    }
  }
  renderWelcome();
}

init();
