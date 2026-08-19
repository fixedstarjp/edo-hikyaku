/**
 * 橋の名所が、実際に街道が水面を渡るところに置かれているか調べる。
 *
 * 淡色地図で街道の各点が水面かどうかを見て、橋の里程との差を出す。
 * 江戸期の水路は暗渠や埋立で消えているものが多いので、水面が見つからない
 * 橋は「今は水が無い」とだけ言う。見つかったのにずれている橋が直す対象。
 *
 *   node tools/check-bridges.mjs            すべての街道
 *   node tools/check-bridges.mjs nakasendo-02
 */
import { PNG } from 'pngjs';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ZOOM = 16, TILE = 256;
const CACHE = resolve(process.cwd(), '.cache/pale');
mkdirSync(CACHE, { recursive: true });
const DEG = Math.PI / 180;
const world = TILE * 2 ** ZOOM;
/** 橋からこの距離までに水面があれば「その橋の川」とみなす (m)。 */
const REACH = 400;

const toPx = (lat, lon) => {
  const r = lat * DEG;
  return {
    x: ((lon + 180) / 360) * world,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * world,
  };
};

const tiles = new Map();
async function tile(tx, ty) {
  const k = `${tx}_${ty}`;
  if (tiles.has(k)) return tiles.get(k);
  const f = resolve(CACHE, `${ZOOM}_${k}.png`);
  if (!existsSync(f)) {
    const r = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/pale/${ZOOM}/${tx}/${ty}.png`);
    if (!r.ok) { tiles.set(k, null); return null; }
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  const p = PNG.sync.read(readFileSync(f));
  tiles.set(k, p);
  return p;
}

async function isWater(lat, lon) {
  const p = toPx(lat, lon);
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  const t = await tile(tx, ty);
  if (!t) return false;
  const i = (t.width * (Math.floor(p.y) - ty * TILE) + (Math.floor(p.x) - tx * TILE)) << 2;
  const [r, g, b] = [t.data[i], t.data[i + 1], t.data[i + 2]];
  return b - r > 12 && b > 200 && g > 190;
}

const only = process.argv[2];
const files = readdirSync(resolve('src/data'))
  .filter((f) => f.endsWith('.generated.json') && f !== 'routes.generated.json')
  .filter((f) => !only || f.startsWith(only));

for (const file of files) {
  const d = JSON.parse(readFileSync(resolve('src/data', file), 'utf8'));
  const { s, x, z } = d.samples;
  const pr = d.projection;
  const un = (X, Z) => [pr.lat0 - Z / pr.kz, pr.lon0 + X / pr.kx];
  const bridges = d.landmarks.filter((l) => l.bridge);
  if (!bridges.length) continue;

  console.log(`\n[${d.meta.id}] ${d.meta.road} ${d.meta.name}`);
  for (const b of bridges) {
    let best = null;
    for (let i = 0; i < s.length; i++) {
      const gap = s[i] - b.s;
      if (Math.abs(gap) > REACH) continue;
      const [lat, lon] = un(x[i], z[i]);
      if (!(await isWater(lat, lon))) continue;
      if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { gap, s: s[i], lat, lon };
    }
    if (!best) {
      console.log(`  ${b.name.padEnd(8)} ${String(Math.round(b.s)).padStart(5)}m  水面なし（暗渠か埋立か、橋の描画で隠れている）`);
    } else {
      const off = Math.round(best.gap);
      const mark = Math.abs(off) > 60 ? '  ← ずれている' : '';
      console.log(
        `  ${b.name.padEnd(8)} ${String(Math.round(b.s)).padStart(5)}m  水面は ${String(Math.round(best.s)).padStart(5)}m ` +
        `(${off > 0 ? '+' : ''}${off}m)  ${best.lat.toFixed(5)}, ${best.lon.toFixed(5)}${mark}`
      );
    }
  }
}
