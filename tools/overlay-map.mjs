/**
 * 街道の打点を地理院の淡色地図に重ねて一枚の画像に焼く。
 * 打点が現況の道や川からどれだけずれているかを目で確かめるための道具。
 *
 *   node tools/_overlay.mjs tokaido-02.generated.json 7500 10049 out.png
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

const toPx = (lat, lon) => {
  const r = lat * DEG;
  return {
    x: ((lon + 180) / 360) * world,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * world,
  };
};

async function tile(tx, ty) {
  const file = resolve(CACHE, `${ZOOM}_${tx}_${ty}.png`);
  if (!existsSync(file)) {
    const res = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/pale/${ZOOM}/${tx}/${ty}.png`);
    if (!res.ok) return null;
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return PNG.sync.read(readFileSync(file));
}

const [file, s0, s1, out] = process.argv.slice(2);
const data = JSON.parse(readFileSync(resolve('src/data', file), 'utf8'));
const { s, x, z } = data.samples;
const pr = data.projection;
const unproject = (X, Z) => [pr.lat0 - Z / pr.kz, pr.lon0 + X / pr.kx];

const pts = [];
for (let i = 0; i < s.length; i++) {
  if (s[i] < Number(s0) || s[i] > Number(s1)) continue;
  const [lat, lon] = unproject(x[i], z[i]);
  pts.push({ s: s[i], ...toPx(lat, lon) });
}

const pad = 90;
const minX = Math.min(...pts.map((p) => p.x)) - pad;
const maxX = Math.max(...pts.map((p) => p.x)) + pad;
const minY = Math.min(...pts.map((p) => p.y)) - pad;
const maxY = Math.max(...pts.map((p) => p.y)) + pad;

const x0 = Math.floor(minX / TILE), x1 = Math.floor(maxX / TILE);
const y0 = Math.floor(minY / TILE), y1 = Math.floor(maxY / TILE);
const W = (x1 - x0 + 1) * TILE, H = (y1 - y0 + 1) * TILE;
const img = new PNG({ width: W, height: H });

for (let tx = x0; tx <= x1; tx++) {
  for (let ty = y0; ty <= y1; ty++) {
    const t = await tile(tx, ty);
    if (!t) continue;
    const ox = (tx - x0) * TILE, oy = (ty - y0) * TILE;
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const a = (t.width * py + px) << 2;
        const b = (W * (oy + py) + ox + px) << 2;
        img.data[b] = t.data[a];
        img.data[b + 1] = t.data[a + 1];
        img.data[b + 2] = t.data[a + 2];
        img.data[b + 3] = 255;
      }
    }
  }
}

const dot = (px, py, r, col) => {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const X = Math.round(px + dx), Y = Math.round(py + dy);
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const o = (W * Y + X) << 2;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2];
    }
  }
};

// 街道の線
for (let i = 1; i < pts.length; i++) {
  const a = pts[i - 1], b = pts[i];
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
  for (let k = 0; k <= n; k++) {
    dot(a.x + ((b.x - a.x) * k) / n - x0 * TILE, a.y + ((b.y - a.y) * k) / n - y0 * TILE, 2, [230, 90, 40]);
  }
}
// 渡しの区間を太く
for (const c of data.crossings ?? []) {
  for (const p of pts) {
    if (p.s >= c.near && p.s <= c.far) dot(p.x - x0 * TILE, p.y - y0 * TILE, 5, [20, 60, 220]);
  }
}
// 名所
for (const lm of data.landmarks) {
  if (lm.s < Number(s0) || lm.s > Number(s1)) continue;
  const [lat, lon] = unproject(lm.x, lm.z);
  const p = toPx(lat, lon);
  dot(p.x - x0 * TILE, p.y - y0 * TILE, 4, [200, 20, 20]);
}

writeFileSync(resolve(out), PNG.sync.write(img));
console.log(`${out}  ${W}x${H}`);
console.log('橙=街道の打点 / 青=いま置いている渡し / 赤=名所');
const toLatLon = (px, py) => {
  const lon = ((px + x0 * TILE) / world) * 360 - 180;
  const n = Math.PI - 2 * Math.PI * ((py + y0 * TILE) / world);
  return [(180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon];
};
const [latNW, lonNW] = toLatLon(0, 0);
const [latSE, lonSE] = toLatLon(W, H);
console.log(`左上 ${latNW.toFixed(5)}, ${lonNW.toFixed(5)}`);
console.log(`右下 ${latSE.toFixed(5)}, ${lonSE.toFixed(5)}`);
console.log(`1px あたり 経度 ${((lonSE - lonNW) / W).toFixed(7)}° / 緯度 ${((latSE - latNW) / H).toFixed(7)}°`);
