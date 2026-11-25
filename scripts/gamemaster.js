// Renders private/gamemaster.html – the game masters' guide: how each riddle is solved,
// hints, solutions, routes and the letters for the meeting place.
import { escapeHtml as e, mdToHtml, roman } from '../src/text.js';
import { stationLetters } from './lib.js';

const list = (items, tag = 'ol') => (items?.length ? `<${tag}>${items.map((x) => `<li>${mdToHtml(x).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</${tag}>` : '');

function answersBlock(answers) {
  if (!answers?.length) return '';
  const [main, ...rest] = answers;
  return `<div class="solution"><span class="lbl">Solution</span><b>${e(main)}</b>${
    rest.length ? `<div class="also">Also accepted: ${rest.map((a) => `<code>${e(a)}</code>`).join(' ')}</div>` : ''
  }</div>`;
}

function hintsBlock(hints) {
  return hints?.length ? `<div class="hints"><span class="lbl">Hints – give them in this order</span>${list(hints)}</div>` : '';
}

function howBlock(steps) {
  return steps?.length
    ? `<div class="how"><span class="lbl">How to solve it</span>${list(steps)}</div>`
    : '<div class="how missing">No solution steps written yet (add <code>solution</code> in hunt.yaml).</div>';
}

function imagesBlock(images, file, transform, originalFile) {
  const img = file ? images.get(file + JSON.stringify(transform || {})) : null;
  if (!img) return '';
  const real = originalFile ? images.get('original:' + originalFile) : null;
  const original = real
    ? `<figure><img src="${real.originalDataUrl}" alt=""><figcaption>Reality (unedited photo)</figcaption></figure>`
    : `<figure><img src="${img.originalDataUrl}" alt=""><figcaption>Original</figcaption></figure>`;
  return `<div class="imgs"><figure><img src="${img.dataUrl}" alt=""><figcaption>What players see</figcaption></figure>${original}</div>`;
}

function stationCard(id, st, no, images) {
  const r = st.riddle;
  const sol = st.solution || {};
  const hints = st.hints || {};
  const loc = st.locationCheck;
  const imgs = imagesBlock(images, r.image, r.transform);

  const locationPart = `
    <div class="part">
      <h4>1 · Find the place <span class="title">“${e(r.title)}”</span></h4>
      ${imgs}
      <details class="seen"><summary>Riddle text as the players see it</summary>${mdToHtml(r.text)}</details>
      ${howBlock(sol.location)}
      ${hintsBlock(hints.location)}
      ${answersBlock(loc?.answers)}
      ${loc?.about ? `<details class="seen"><summary>“About this place” text shown after solving</summary>${mdToHtml(loc.about)}</details>` : ''}
    </div>`;

  const onSitePart = `
    <div class="part">
      <h4>2 · On site <span class="title">“${e(st.onSite.title || 'On site')}”</span></h4>
      ${imagesBlock(images, st.onSite.image, st.onSite.transform, st.onSite.original)}
      <details class="seen"><summary>Question as the players see it</summary>${mdToHtml(st.onSite.question)}</details>
      ${howBlock(sol.onSite)}
      ${hintsBlock(hints.onSite)}
      ${answersBlock(st.onSite.answers)}
    </div>`;

  return `
  <section class="station" id="st-${e(id)}">
    <h3><span class="no">${roman(no)}</span> ${e(st.name || id)}</h3>
    ${stationLetters(st).length ? `<div class="gives"><span class="lbl">Letters this station gives</span>${lettersHtml(st)}</div>` : ''}
    ${loc ? locationPart : ''}
    ${onSitePart}
  </section>`;
}

const lettersHtml = (st) => stationLetters(st).map((l) => `<span class="tile">${e(l)}</span>`).join('') || '–';

function teamTable(team, content) {
  const rows = team.route
    .map(
      (id, k) =>
        `<tr><td class="n">${roman(k + 1)}</td><td><a href="#st-${e(id)}">${e(content.stations[id].name || id)}</a></td><td>${lettersHtml(content.stations[id])}</td></tr>`
    )
    .join('');
  const final = content.meetingPlace
    ? `<tr><td class="n">→</td><td><a href="#meeting-place">Last riddle: the meeting place</a></td><td></td></tr>`
    : '';
  return `
  <section class="team">
    <h3>${e(team.name)} <small>Team ${team.numeral}</small></h3>
    <table>
      <tr><th></th><th>Station</th><th>Letters</th></tr>
      ${rows}${final}
    </table>
  </section>`;
}

function meetingPlaceCard(mp) {
  if (!mp) return '';
  return `
  <section class="station" id="meeting-place">
    <h3><span class="no">→</span> ${e(mp.title || 'Where we meet again')}</h3>
    <details class="seen"><summary>Text as the players see it</summary>${mdToHtml(mp.text)}</details>
    ${howBlock(mp.solution)}
    ${hintsBlock(mp.hints)}
    ${answersBlock(mp.answers)}
  </section>`;
}

export function renderGamemaster(content, teams, images) {
  const meta = content.meta || {};

  // stations once, in the order of the first team's route (= the loop)
  const order = [...new Set([...(teams[0]?.route || []), ...Object.keys(content.stations)])];
  const stations = order.map((id, i) => stationCard(id, content.stations[id], i + 1, images)).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Game masters' guide – ${e(meta.title || 'Riga Hunt')}</title>
<style>
  body { margin: 0; font-family: -apple-system, 'Segoe UI', system-ui, sans-serif; color: #1d2b2a; background: #f6f2e8; line-height: 1.45; }
  main { max-width: 860px; margin: 0 auto; padding: 24px; }
  h1 { font-family: Georgia, serif; font-weight: 400; font-size: 34px; margin: 0 0 4px; color: #12302F; }
  h2 { font-family: Georgia, serif; font-weight: 400; font-size: 28px; color: #12302F; border-bottom: 2px solid #C9A24A; padding-bottom: 6px; margin: 40px 0 16px; }
  h3 { font-family: Georgia, serif; font-weight: 400; font-size: 23px; color: #12302F; margin: 0 0 10px; }
  h3 small { font-size: 14px; color: #7a6a3a; letter-spacing: 0.1em; }
  h4 { margin: 0 0 8px; font-size: 16px; color: #12302F; }
  h4 .title { font-weight: 400; color: #6b5d3a; }
  .no { display: inline-block; min-width: 34px; text-align: center; background: #12302F; color: #EFE6CF; border-radius: 6px; padding: 0 8px; font-size: 18px; margin-right: 6px; }
  .warn { background: #fff3d6; border: 1px solid #e0b64d; padding: 10px 14px; border-radius: 8px; }
  .lbl { display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #8a7440; margin-bottom: 4px; }
  code { background: #fff; border: 1px solid #d8cfb8; border-radius: 4px; padding: 1px 6px; font-size: 13.5px; display: inline-block; margin: 2px 2px 2px 0; overflow-wrap: anywhere; }
  .tile { display: inline-block; min-width: 22px; text-align: center; font-weight: 700; color: #12302F; background: #f1e3b8; border: 1px solid #C9A24A; border-radius: 4px; padding: 0 5px; margin-right: 4px; }
  .gives { margin-bottom: 4px; }
  .station { background: #fff; border: 1px solid #e3d9c0; border-radius: 12px; padding: 18px 20px; margin: 18px 0; }
  .part { border-top: 1px dashed #d8cfb8; padding-top: 12px; margin-top: 12px; }
  .how ol, .hints ol { margin: 0; padding-left: 22px; }
  .how li { margin: 3px 0; }
  .how, .hints, .solution { margin-top: 10px; }
  .how.missing { color: #a33; font-size: 13px; }
  .hints { color: #3d4a49; }
  .solution b { font-size: 17px; color: #12302F; }
  .also { font-size: 13px; color: #555; margin-top: 2px; }
  details.seen { margin-top: 8px; font-size: 13.5px; color: #444; background: #faf7ef; border-radius: 8px; padding: 6px 10px; }
  details.seen summary { cursor: pointer; font-weight: 600; color: #6b5d3a; }
  details.seen p { margin: 6px 0; }
  .imgs { display: flex; gap: 12px; margin-top: 8px; }
  .imgs figure { margin: 0; flex: 1; }
  .imgs img { width: 100%; border-radius: 6px; border: 1px solid #d8cfb8; }
  figcaption { font-size: 12px; color: #777; }
  table { border-collapse: collapse; width: 100%; background: #fff; }
  td, th { border: 1px solid #d8cfb8; padding: 7px 8px; font-size: 14px; text-align: left; vertical-align: top; }
  td.n { width: 34px; font-weight: 700; color: #12302F; }
  td.box { width: 70px; }
  a { color: #12302F; }
  .team { margin: 18px 0; }
  ul.howto { padding-left: 20px; }
  @media print {
    body { background: #fff; } main { padding: 0; } .warn { display: none; }
    /* Cards may split across pages (a whole card can be taller than the space left under a heading,
       which used to push it to the next page and leave the heading alone on an empty page).
       Keep the small blocks whole and headings attached to what follows. */
    h2 { break-before: page; } h2.first { break-before: auto; }
    .station { break-before: page; } h2 + .station { break-before: auto; }
    h2, h3, h4, .gives, details.seen summary { break-after: avoid-page; }
    .how, .hints, .solution, .imgs, details.seen, .team { break-inside: avoid-page; }
  }
</style>
</head>
<body>
<main>
  <h1>${e(meta.title || 'The Riga Hunt')} · Game masters' guide</h1>
  <p class="warn">🔒 Contains all solutions. Do not share this file with players. Print to PDF to read it on your phone (collapsed sections are opened automatically for printing).</p>
  <ul class="howto">
    <li><b>Hints:</b> teams ask you (e.g. on WhatsApp). Give the hints of a step in order, one at a time.</li>
    <li><b>Really stuck?</b> If a team can't solve a step – or an on-site detail is covered or missing – tell them the answer (the bold one under “Solution”). They type it in like any other answer.</li>
    <li><b>Answers</b> are checked ignoring case, accents, spaces, punctuation and a leading “the”. If a team has a correct answer in a spelling that isn't accepted, tell them the accepted spelling.</li>
    <li><b>Letters:</b> after each station the app shows the team its letter(s) and tells them to remember them. At the end they unscramble all letters into the meeting place and type it in.</li>
    <li><b>Photos:</b> every team needs a team photo at every station. Check them (and the side-quest photos) at the end.</li>
  </ul>

  <h2 class="first">Teams – routes &amp; letters</h2>
  ${teams.map((t) => teamTable(t, content)).join('')}

  <h2>Stations – how to solve them</h2>
  ${stations}
  ${meetingPlaceCard(content.meetingPlace)}

</main>
<script>
  window.addEventListener('beforeprint', () => document.querySelectorAll('details').forEach((d) => (d.open = true)));
</script>
</body>
</html>`;
}
