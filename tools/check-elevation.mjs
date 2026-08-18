/**
 * 打点が高架構造物の上に乗っていないか調べる。
 *
 * 都市部の 1m レーザ標高は高架の鉄道や道路の路面を拾う。その上に打点が乗ると、
 * ありもしない丘が街道に生まれる。打点の東西を掃いて、地面らしい低い帯がどこかを見る。
 *
 *   node tools/_lowland.mjs tokaido-02.json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = process.argv[2];
const route = JSON.parse(readFileSync(resolve('data/routes', file), 'utf8'));

const api = 'https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php';
const at = async (lat, lon) => {
  const res = await fetch(`${api}?lon=${lon}&lat=${lat}&outtype=JSON`);
  const j = await res.json();
  return typeof j.elevation === 'number' ? j.elevation : null;
};

const OFFSETS = [-0.0030, -0.0020, -0.0010, 0, 0.0010, 0.0020, 0.0030];

console.log(`[${route.id}] 打点の東西の標高 (m)。左が西、右が東。`);
console.log('  #   緯度      経度       ' + OFFSETS.map((o) => String(Math.round(o * 90600)).padStart(6)).join(''));

for (let i = 0; i < route.waypoints.length; i++) {
  const [lat, lon] = route.waypoints[i];
  const row = [];
  for (const o of OFFSETS) row.push(await at(lat, lon + o));
  const here = row[3];
  const low = Math.min(...row.filter((v) => v !== null));
  const flag = here !== null && here - low > 4 ? '  ← 高い。高架の上かもしれない' : '';
  console.log(
    String(i).padStart(3) + '  ' + lat.toFixed(5) + '  ' + lon.toFixed(5) + '  ' +
    row.map((v) => (v === null ? '     -' : v.toFixed(1).padStart(6))).join('') + flag
  );
}
