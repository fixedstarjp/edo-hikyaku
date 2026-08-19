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
/**
 * 打点が二つ以上続けば、幅 15m 以上の水面として信用してよい。
 *
 * 一点きりの青は当てにならない。麻布の一の橋では、古川の真上を首都高が
 * 覆っていて水面が描かれず、280m 離れた別の青い画素を拾ってしまった。
 * ただし細い川では一点しか当たらないこともある（板橋の石神井川、
 * 赤坂の外堀）。捨てずに「要確認」と印を付け、地図で見る手掛かりに残す。
 */
const SURE_RUN = 2;

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
    // 連続した水面の区間を拾い、一点きりのものは捨てる
    const runs = [];
    let cur = null;
    for (let i = 0; i < s.length; i++) {
      if (Math.abs(s[i] - b.s) > REACH) { cur = null; continue; }
      const [lat, lon] = un(x[i], z[i]);
      if (await isWater(lat, lon)) {
        if (cur) { cur.to = i; cur.n++; }
        else cur = { from: i, to: i, n: 1 };
        if (cur.n === 1) runs.push(cur);
      } else cur = null;
    }
    let best = null;
    for (const r of runs) {
      const mid = Math.floor((r.from + r.to) / 2);
      const gap = s[mid] - b.s;
      const [lat, lon] = un(x[mid], z[mid]);
      if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { gap, s: s[mid], lat, lon, n: r.n };
    }
    if (!best) {
      console.log(`  ${b.name.padEnd(8)} ${String(Math.round(b.s)).padStart(5)}m  水面なし（暗渠・埋立・橋や高架の描画で隠れている。地図を目で見て確かめること）`);
    } else {
      const off = Math.round(best.gap);
      const mark = Math.abs(off) > 60 ? '  ← ずれている' : '';
      const sure = best.n >= SURE_RUN ? '' : '  ※一点きり。地図で目視すること';
      console.log(
        `  ${b.name.padEnd(8)} ${String(Math.round(b.s)).padStart(5)}m  水面は ${String(Math.round(best.s)).padStart(5)}m ` +
        `(${off > 0 ? '+' : ''}${off}m)  ${best.lat.toFixed(5)}, ${best.lon.toFixed(5)}${mark}${sure}`
      );
    }
  }
}
