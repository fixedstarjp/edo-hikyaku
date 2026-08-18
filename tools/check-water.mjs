/**
 * 街道が水面に掛かる里程を、地理院の淡色地図タイルから調べる。
 * 渡しを置いた場所が本当に川の上かを確かめるための道具。
 *
 *   node tools/check-water.mjs tokaido-02.generated.json 9000 11000
 */
import { PNG } from 'pngjs';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ZOOM = 16;
const TILE = 256;
const CACHE = resolve(process.cwd(), '.cache/pale');
mkdirSync(CACHE, { recursive: true });

const DEG = Math.PI / 180;
const world = TILE * 2 ** ZOOM;

function toPx(lat, lon) {
  const r = lat * DEG;
  return {
    x: ((lon + 180) / 360) * world,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * world,
  };
}
function toLatLon(x, y) {
  const lon = (x / world) * 360 - 180;
  const n = Math.PI - 2 * Math.PI * (y / world);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return [lat, lon];
}

const tiles = new Map();
async function tile(tx, ty) {
  const key = `${tx}_${ty}`;
  if (tiles.has(key)) return tiles.get(key);
  const file = resolve(CACHE, `${ZOOM}_${key}.png`);
  let buf;
  if (existsSync(file)) buf = readFileSync(file);
  else {
    const url = `https://cyberjapandata.gsi.go.jp/xyz/pale/${ZOOM}/${tx}/${ty}.png`;
    const res = await fetch(url);
    if (!res.ok) { tiles.set(key, null); return null; }
    buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(file, buf);
  }
  const png = PNG.sync.read(buf);
  tiles.set(key, png);
  return png;
}

/** その緯度経度が水面か。 */
async function isWater(lat, lon) {
  const p = toPx(lat, lon);
  const tx = Math.floor(p.x / TILE);
  const ty = Math.floor(p.y / TILE);
  const png = await tile(tx, ty);
  if (!png) return null;
  const px = Math.floor(p.x) - tx * TILE;
  const py = Math.floor(p.y) - ty * TILE;
  const i = (png.width * py + px) << 2;
  const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
  // 淡色地図の水面は淡い青。青が赤より明確に強い。
  return b - r > 12 && b > 200 && g > 190;
}

const [file, s0, s1] = process.argv.slice(2);
const data = JSON.parse(readFileSync(resolve('src/data', file), 'utf8'));
const { s, x, z } = data.samples;
const pr = data.projection;
const unproject = (X, Z) => [pr.lat0 - Z / pr.kz, pr.lon0 + X / pr.kx];

const from = Number(s0), to = Number(s1);
const runs = [];
let cur = null;
for (let i = 0; i < s.length; i++) {
  if (s[i] < from || s[i] > to) continue;
  const [lat, lon] = unproject(x[i], z[i]);
  const w = await isWater(lat, lon);
  if (w) {
    if (!cur) cur = { from: s[i], to: s[i], lat0: lat, lon0: lon };
    else { cur.to = s[i]; cur.lat1 = lat; cur.lon1 = lon; }
  } else if (cur) { runs.push(cur); cur = null; }
}
if (cur) runs.push(cur);

console.log(`[${file}] ${from}m〜${to}m で街道が水面に掛かる区間`);
for (const r of runs) {
  console.log(`  ${Math.round(r.from)}m 〜 ${Math.round(r.to)}m  (幅 ${Math.round(r.to - r.from)}m)  ` +
    `中心 ${((r.from + r.to) / 2).toFixed(0)}m  ${((r.lat0 + (r.lat1 ?? r.lat0)) / 2).toFixed(5)}, ${((r.lon0 + (r.lon1 ?? r.lon0)) / 2).toFixed(5)}`);
}
if (!runs.length) console.log('  水面に掛かる区間なし');

for (const c of data.crossings ?? []) {
  console.log(`  → いま置いている渡し: ${c.at}  ${c.near}m 〜 ${c.far}m (中心 ${c.s}m)`);
}
