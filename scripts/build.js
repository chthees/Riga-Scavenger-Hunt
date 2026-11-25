// Build: content/hunt.yaml → docs/index.html (public) + private/gamemaster.html (secret)
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import * as esbuild from 'esbuild';
import { createLock, encryptJson, encodeText, toHex, TROLL_PREFIX, KDF_ITERATIONS } from '../src/crypto.js';
import { escapeHtml } from '../src/text.js';
import { loadContent, validateContent, planTeams, allDecoys, allEggs, contentKey } from './lib.js';
import { renderGamemaster } from './gamemaster.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(ROOT);

const exists = (p) => access(p).then(() => true, () => false);

// ---------- 1. load + validate ----------

const content = await loadContent();
const { errors, warnings } = validateContent(content);
warnings.forEach((w) => console.warn('⚠  ' + w));
if (errors.length) {
  errors.forEach((e) => console.error('✖  ' + e));
  console.error(`\nBuild failed: ${errors.length} error(s).`);
  process.exit(1);
}
const meta = content.meta || {};
const teams = planTeams(content);

// ---------- 2. images ----------

const images = new Map();

async function processImage(relPath, t = {}) {
  const src = path.join('content', relPath);
  let buf = await sharp(src, { density: 144 }).rotate().png().toBuffer();
  const original = await sharp(buf).resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();

  if (t.crop) {
    const { width: W, height: H } = await sharp(buf).metadata();
    buf = await sharp(buf)
      .extract({
        left: Math.round(t.crop.left * W),
        top: Math.round(t.crop.top * H),
        width: Math.round(t.crop.width * W),
        height: Math.round(t.crop.height * H),
      })
      .png()
      .toBuffer();
  }
  if (t.rotate) buf = await sharp(buf).rotate(t.rotate, { background: '#12302F' }).png().toBuffer();
  if (t.flip) buf = await sharp(buf).flop().png().toBuffer(); // horizontal mirror
  if (t.flipVertical) buf = await sharp(buf).flip().png().toBuffer();
  if (t.grayscale) buf = await sharp(buf).grayscale().png().toBuffer();
  if (t.levels) {
    // levels: [black, white] – stretch this brightness range to full black…white (harsh, printed look)
    const [lo, hi] = t.levels;
    const a = 255 / (hi - lo);
    buf = await sharp(buf).linear(a, -lo * a).png().toBuffer();
  }
  if (t.negate) buf = await sharp(buf).negate({ alpha: false }).png().toBuffer();
  if (t.hue) buf = await sharp(buf).modulate({ hue: t.hue }).png().toBuffer();
  buf = await sharp(buf).resize({ width: 1000, withoutEnlargement: true }).png().toBuffer();
  if (t.pixelate) {
    const { width } = await sharp(buf).metadata();
    const small = Math.max(4, Math.round(width / t.pixelate));
    buf = await sharp(buf).resize({ width: small, kernel: 'nearest' }).png().toBuffer();
    buf = await sharp(buf).resize({ width, kernel: 'nearest' }).png().toBuffer();
  }
  const out = await sharp(buf).jpeg({ quality: 74 }).toBuffer();
  return {
    dataUrl: 'data:image/jpeg;base64,' + out.toString('base64'),
    originalDataUrl: 'data:image/jpeg;base64,' + original.toString('base64'),
  };
}

for (const team of teams) {
  for (const step of team.steps) {
    if (!step.image) continue;
    const k = step.image.path + JSON.stringify(step.image.transform);
    if (!images.has(k)) images.set(k, await processImage(step.image.path, step.image.transform));
    step.payload.image = images.get(k).dataUrl;
  }
}
// onSite.original: the unedited photo behind an on-site picture (e.g. spot the fake) – game masters' guide only
for (const st of Object.values(content.stations)) {
  const p = st.onSite?.original;
  if (p && !images.has('original:' + p)) images.set('original:' + p, await processImage(p));
}

// ---------- 3. encrypt ----------

const data = {
  v: 1,
  iterations: KDF_ITERATIONS,
  title: meta.title || 'The Riga Hunt',
  kicker: meta.kicker || '',
  intro: meta.intro || '',
  hintText: meta.hintText || 'Stuck? Ask the game masters for a hint.',
  photoRule: meta.photoRule || '',
  sidequests: (content.sidequests || []).map((text, i) => ({ id: 'q' + (i + 1), text })),
  teams: [],
  troll: null,
};

for (const team of teams) {
  const locks = [];
  const steps = [];
  for (let i = 0; i < team.steps.length; i++) {
    const step = team.steps[i];
    const key = contentKey(content.secret, team.id, i);
    if (i === 0) locks.push(null); // first step is open – its key is published as startKey
    else {
      const prevHex = toHex(contentKey(content.secret, team.id, i - 1));
      locks.push(await createLock(prevHex, step.unlockAnswers.map((answer) => ({ answer, secret: key }))));
    }
    steps.push(await encryptJson(key, step.payload));
  }
  const startKey = toHex(contentKey(content.secret, team.id, 0));
  data.teams.push({ id: team.id, name: team.name, numeral: team.numeral, startKey, locks, steps });
}

const decoys = allDecoys(content);
const trollMessages = content.decoys?.trollMessages?.length ? content.decoys.trollMessages : ['Nice try.'];
const trollEntries = [
  ...decoys.map((answer, i) => ({ answer, secret: encodeText(trollMessages[i % trollMessages.length]) })),
  ...allEggs(content).map(({ answer, message }) => ({ answer, secret: encodeText(message) })),
];
if (trollEntries.length) {
  data.troll = await createLock(TROLL_PREFIX, trollEntries, { slotCount: Math.max(16, trollEntries.length) });
}

// ---------- 4. bundle app + css ----------

const js = await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
  legalComments: 'none',
});
const appJs = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

let css = '';
if (await exists('src/fonts/fonts.css')) {
  const fontsCss = await readFile('src/fonts/fonts.css', 'utf8');
  const parts = [];
  let last = 0;
  for (const m of fontsCss.matchAll(/url\(\.\/([^)]+\.woff2)\)/g)) {
    parts.push(fontsCss.slice(last, m.index));
    const b64 = (await readFile(path.join('src/fonts', m[1]))).toString('base64');
    parts.push(`url(data:font/woff2;base64,${b64})`);
    last = m.index + m[0].length;
  }
  parts.push(fontsCss.slice(last));
  css += parts.join('');
} else {
  console.warn('⚠  src/fonts/fonts.css missing – run `npm run fonts`. Falling back to system fonts.');
}
css += await readFile('src/style.css', 'utf8');
css = (await esbuild.transform(css, { loader: 'css', minify: true })).code;

// ---------- 5. render index.html (with decoys) ----------

const d = content.decoys || {};
const teamKeys = (obj) => Object.entries(obj || {});
const decoyComment = teamKeys(d.todoComment)
  .map(([team, list]) => `    ${team}: ${list.join(' / ')}`)
  .join('\n')
  .replace(/--/g, '- -');
const decoyDev = JSON.stringify(d.devAnswers || {}, null, 4).replace(/\n/g, '\n  ').replace(/</g, '\\u003c');
const decoyB64 = Buffer.from(
  JSON.stringify({ backup: d.encodedBackup || [], note: 'restore if decryption fails' })
).toString('base64');

const replacements = {
  __TITLE__: escapeHtml(data.title),
  __DECOY_COMMENT__: decoyComment,
  '/*__STYLE__*/': css.replace(/<\/style/gi, '<\\/style'),
  __DECOY_ATTR__: escapeHtml(d.hiddenAttribute || ''),
  __DECOY_DEV__: decoyDev,
  __DECOY_B64__: decoyB64,
  __DATA__: JSON.stringify(data).replace(/</g, '\\u003c'),
  '/*__APP__*/': appJs,
};

let html = await readFile('src/template.html', 'utf8');
for (const [k, v] of Object.entries(replacements)) {
  if (!html.includes(k)) throw new Error(`Template placeholder ${k} missing`);
  html = html.split(k).join(v);
}

await mkdir('docs', { recursive: true });
await writeFile('docs/index.html', html);
await writeFile('docs/.nojekyll', '');

// ---------- 6. game masters' guide ----------

await mkdir('private', { recursive: true });
await writeFile('private/gamemaster.html', renderGamemaster(content, teams, images));

// ---------- summary ----------

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`\n✔ docs/index.html          ${kb(Buffer.byteLength(html))}`);
console.log(`✔ private/gamemaster.html  (secret – do not commit)`);
for (const t of teams) {
  console.log(`  ${t.name.padEnd(14)} ${t.steps.length} steps`);
}
console.log('\nNext: npm run verify');
