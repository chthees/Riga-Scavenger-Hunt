// Makes an unlabelled map snippet for a "map fragment" riddle, drawn from raw
// OpenStreetMap data – so there are no street names or labels at all.
//
//   node scripts/make-map.js <lat> <lon> <out.png> [--size 1000] [--dx 0] [--dy 0] [--px 1000]
//
//   --size  width/height of the area in metres (square, keep it ≲ 1500 m)
//   --dx/dy shift the window in metres (east / south), so the X isn't dead centre
//   --px    output width in pixels
//   --x-size half the width of the X in px (default 24), --x-color its colour (default red)
//
// Data comes from the OpenStreetMap API's `map` call (one request, fine for small areas).
// Draws water, parks, buildings, streets, railways and bridges, marks the target with
// an X and adds the attribution required by the ODbL. Rotation is done later by the
// build (`transform.rotate` in hunt.yaml), so the original stays north-up.
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const [latS, lonS, out] = args;
if (!out) {
  console.error('usage: node scripts/make-map.js <lat> <lon> <out.png> [--size 1000] [--dx 0] [--dy 0] [--px 1000]');
  process.exit(1);
}
const lat0 = Number(latS);
const lon0 = Number(lonS);
const sizeM = opt('size', 1000);
const dxM = opt('dx', 0);
const dyM = opt('dy', 0);
const W = opt('px', 1000);
const xSize = opt('x-size', 24); // half the X's width in px
const xColor = args.includes('--x-color') ? args[args.indexOf('--x-color') + 1] : '#c0392b';
const scale = W / sizeM; // px per metre

// ---------- projection (local equirectangular – fine for a 1 km window) ----------
const M_LAT = 110574;
const M_LON = 111320 * Math.cos((lat0 * Math.PI) / 180);
const cx = sizeM / 2 - dxM; // position of the target in the window, metres from the left/top edge
const cy = sizeM / 2 - dyM;
const proj = ({ lat, lon }) => [((lon - lon0) * M_LON + cx) * scale, ((lat0 - lat) * M_LAT + cy) * scale];

const pad = 100; // metres around the window, so shapes run off the edge cleanly
const south = lat0 - (sizeM - cy + pad) / M_LAT;
const north = lat0 + (cy + pad) / M_LAT;
const west = lon0 - (cx + pad) / M_LON;
const east = lon0 + (sizeM - cx + pad) / M_LON;

// ---------- fetch + parse OSM XML ----------
const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${[west, south, east, north].map((v) => v.toFixed(6)).join(',')}`;
const res = await fetch(url, { headers: { 'User-Agent': 'riga-hunt-map-builder/1.0' } });
if (!res.ok) throw new Error(`OSM API: HTTP ${res.status} ${await res.text()}`);
const xml = await res.text();

const attr = (s, name) => s.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const tagsOf = (body) => Object.fromEntries([...body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)].map((m) => [m[1], m[2]]));

const nodes = new Map();
for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
  nodes.set(attr(m[1], 'id'), { lat: Number(attr(m[1], 'lat')), lon: Number(attr(m[1], 'lon')) });
}
const ways = new Map();
for (const m of xml.matchAll(/<way ([^>]*)>([\s\S]*?)<\/way>/g)) {
  const geometry = [...m[2].matchAll(/<nd ref="(\d+)"\s*\/>/g)].map((n) => nodes.get(n[1])).filter(Boolean);
  ways.set(attr(m[1], 'id'), { type: 'way', tags: tagsOf(m[2]), geometry });
}
const elements = [...ways.values()];
for (const m of xml.matchAll(/<relation ([^>]*)>([\s\S]*?)<\/relation>/g)) {
  const members = [...m[2].matchAll(/<member type="(\w+)" ref="(\d+)" role="([^"]*)"\s*\/>/g)]
    .filter((x) => x[1] === 'way' && ways.has(x[2]))
    .map((x) => ({ type: 'way', role: x[3], geometry: ways.get(x[2]).geometry }));
  elements.push({ type: 'relation', tags: tagsOf(m[2]), members });
}

// ---------- geometry helpers ----------
const f = (n) => n.toFixed(1);
const line = (geom) => geom.map((p, i) => (i ? 'L' : 'M') + proj(p).map(f).join(' ')).join('');
const ring = (geom) => line(geom) + 'Z';

/** Join a relation's member ways into closed rings (members come split into pieces). */
function rings(members) {
  const segs = members.filter((m) => m.geometry?.length).map((m) => m.geometry.slice());
  const same = (a, b) => a.lat === b.lat && a.lon === b.lon;
  const out = [];
  while (segs.length) {
    const r = segs.shift();
    let grown = true;
    while (!same(r[0], r[r.length - 1]) && grown) {
      grown = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const end = r[r.length - 1];
        if (same(s[0], end)) r.push(...s.slice(1));
        else if (same(s[s.length - 1], end)) r.push(...s.reverse().slice(1));
        else continue;
        segs.splice(i, 1);
        grown = true;
        break;
      }
    }
    out.push(r);
  }
  return out;
}

const area = (e) =>
  e.type === 'relation' ? rings(e.members).map(ring).join('') : e.geometry?.length ? ring(e.geometry) : '';

// ---------- classify ----------
const GREEN_LEISURE = new Set(['park', 'garden']);
const GREEN_LANDUSE = new Set(['grass', 'recreation_ground', 'cemetery', 'village_green']);
const water = [];
const green = [];
const buildings = [];
const roads = { major: [], mid: [], minor: [], path: [] };
const bridges = [];
const rails = [];
const trams = [];

for (const e of elements) {
  const t = e.tags || {};
  if (t.natural === 'water' || t.waterway === 'riverbank') water.push(area(e));
  else if (e.type === 'relation') continue;
  else if (GREEN_LEISURE.has(t.leisure) || GREEN_LANDUSE.has(t.landuse)) green.push(area(e));
  else if (t.building) buildings.push(area(e));
  else if (t.railway === 'rail') rails.push(line(e.geometry));
  else if (t.railway === 'tram') trams.push(line(e.geometry));
  else if (t.highway && e.geometry.length > 1) {
    if (t.area === 'yes' || t.highway === 'platform') continue;
    const h = t.highway.replace('_link', '');
    const cls = ['motorway', 'trunk', 'primary'].includes(h)
      ? 'major'
      : ['secondary', 'tertiary'].includes(h)
        ? 'mid'
        : ['residential', 'unclassified', 'living_street', 'service', 'road'].includes(h)
          ? 'minor'
          : 'path';
    (t.bridge && cls !== 'path' ? bridges : roads[cls]).push(line(e.geometry));
  }
}

// ---------- render ----------
const width = { major: 13, mid: 10, minor: 6, path: 2.2 }; // px at 1000 px / 900 m
const k = scale * 0.9;
const stroke = (paths, color, w, extra = '') =>
  paths.length
    ? `<path d="${paths.join('')}" fill="none" stroke="${color}" stroke-width="${f(w * k)}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`
    : '';
const roadLayer = (cls, casing) =>
  stroke(
    roads[cls],
    casing ? '#b9ad96' : cls === 'path' ? '#c9bda5' : '#ffffff',
    width[cls] + (casing ? 2.4 : 0),
    cls === 'path' && !casing ? 'stroke-dasharray="4 3"' : ''
  );

const [tx, ty] = proj({ lat: lat0, lon: lon0 });
const r = xSize;
const xPath = `M${f(tx - r)} ${f(ty - r)}L${f(tx + r)} ${f(ty + r)}M${f(tx + r)} ${f(ty - r)}L${f(tx - r)} ${f(ty + r)}`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
  <rect width="100%" height="100%" fill="#f3eee2"/>
  <path d="${green.join('')}" fill="#d3e2bd" fill-rule="evenodd"/>
  <path d="${water.join('')}" fill="#a9c9d8" fill-rule="evenodd"/>
  <path d="${buildings.join('')}" fill="#ddd3c2" stroke="#cbbfa9" stroke-width="0.6"/>
  ${stroke(rails, '#8a8173', 4 * k)}${stroke(rails, '#f3eee2', 2 * k, 'stroke-dasharray="7 7"')}
  ${['path', 'minor', 'mid', 'major'].map((c) => roadLayer(c, true)).join('')}
  ${['path', 'minor', 'mid', 'major'].map((c) => roadLayer(c, false)).join('')}
  ${stroke(trams, '#9c8f7a', 1.2 * k)}
  ${stroke(bridges, '#6f6656', 15 * k)}${stroke(bridges, '#ffffff', 11 * k)}
  <path d="${xPath}" stroke="#ffffff" stroke-width="${f(xSize * 0.75)}" stroke-linecap="round"/>
  <path d="${xPath}" stroke="${xColor}" stroke-width="${f(xSize * 0.45)}" stroke-linecap="round"/>
  <rect x="${W - 250}" y="${W - 30}" width="250" height="30" fill="#ffffff" fill-opacity="0.8"/>
  <text x="${W - 10}" y="${W - 10}" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#444" text-anchor="end">© OpenStreetMap contributors</text>
</svg>`;

const png = await sharp(Buffer.from(svg)).png().toBuffer();
await writeFile(out, png);
console.log(`✔ ${out}  (${W}×${W} px, ${sizeM} m, ${nodes.size} nodes, ${ways.size} ways)`);
