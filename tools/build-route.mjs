/**
 * 街道データのビルド。
 *
 *   data/route-*.json (手動デジタイズの緯度経度)
 *     -> 等間隔リサンプル
 *     -> 国土地理院 標高タイルから標高を取得
 *     -> ローカル平面座標へ投影
 *     -> src/data/route-01.generated.json
 *
 * 標高タイルは .cache/dem/ にキャッシュするので、二度目以降は通信しない。
 *
 * 出典: 国土地理院 標高タイル (DEM5A / DEM10B)
 *       https://maps.gsi.go.jp/development/ichiran.html
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'data/route-01-nihonbashi-shinagawa.json');
const OUT = resolve(ROOT, 'src/data/route-01.generated.json');
const CACHE = resolve(ROOT, '.cache/dem');

/** リサンプル間隔 (m)。8km を約 530 点にする。 */
const STEP_M = 15;
/**
 * 標高の平滑化。
 * 都市部の DEM は掘割・高架・再開発の造成を拾うため、数十 m 幅のスパイクが出る。
 * まず中央値フィルタでスパイクを落とし、次に移動平均でならす。
 * 峠のような本物の坂は数百 m 以上続くので、この窓幅なら消えない。
 */
const MEDIAN_WINDOW = 5; // 75m
const SMOOTH_WINDOW = 15; // 225m

const R_EARTH = 6378137;
const DEG = Math.PI / 180;

/* ---------------------------------------------------------------- 測地計算 */

/** 2 点間の大円距離 (m)。 */
function haversine(a, b) {
  const dLat = (b[0] - a[0]) * DEG;
  const dLon = (b[1] - a[1]) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * DEG) * Math.cos(b[0] * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}

/** 折れ線を等間隔にリサンプルする。端点は必ず含む。 */
function resample(waypoints, stepM) {
  const cum = [0];
  for (let i = 1; i < waypoints.length; i++) {
    cum.push(cum[i - 1] + haversine(waypoints[i - 1], waypoints[i]));
  }
  const total = cum[cum.length - 1];
  const out = [];
  let seg = 0;
  for (let d = 0; d < total; d += stepM) {
    while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
    const t = (d - cum[seg]) / (cum[seg + 1] - cum[seg]);
    out.push([
      waypoints[seg][0] + (waypoints[seg + 1][0] - waypoints[seg][0]) * t,
      waypoints[seg][1] + (waypoints[seg + 1][1] - waypoints[seg][1]) * t,
    ]);
  }
  out.push(waypoints[waypoints.length - 1]);
  return { points: out, totalLength: total };
}

/* ------------------------------------------------------- 国土地理院 DEM タイル */

/** 標高タイルのセット。上から順に試し、欠測なら次へ落とす。 */
const DEM_SETS = [
  { name: 'dem5a_png', zoom: 15, label: 'DEM5A (5m メッシュ)' },
  { name: 'dem_png', zoom: 14, label: 'DEM10B (10m メッシュ)' },
];

const tileCache = new Map();

function tileCoords(lat, lon, zoom) {
  const n = 2 ** zoom;
  const fx = ((lon + 180) / 360) * n;
  const latRad = lat * DEG;
  const fy =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return {
    x: Math.floor(fx),
    y: Math.floor(fy),
    px: Math.min(255, Math.floor((fx - Math.floor(fx)) * 256)),
    py: Math.min(255, Math.floor((fy - Math.floor(fy)) * 256)),
  };
}

async function loadTile(set, zoom, x, y) {
  const key = `${set}/${zoom}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);

  const file = resolve(CACHE, `${set}/${zoom}/${x}/${y}.png`);
  let buf = null;
  if (existsSync(file)) {
    buf = readFileSync(file);
  } else {
    const url = `https://cyberjapandata.gsi.go.jp/xyz/${set}/${zoom}/${x}/${y}.png`;
    const res = await fetch(url);
    if (res.status === 404) {
      // タイル自体が存在しない (海上など)
      tileCache.set(key, null);
      return null;
    }
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buf);
    process.stdout.write('.');
  }

  const png = PNG.sync.read(buf);
  tileCache.set(key, png);
  return png;
}

/** 標高タイルの RGB を標高 (m) に復号する。欠測は null。 */
function decodeElevation(png, px, py) {
  const i = (png.width * py + px) << 2;
  const r = png.data[i];
  const g = png.data[i + 1];
  const b = png.data[i + 2];
  const v = r * 65536 + g * 256 + b;
  if (v === 0x800000) return null; // 欠測
  return v < 0x800000 ? v * 0.01 : (v - 0x1000000) * 0.01;
}

async function elevationAt(lat, lon) {
  for (const set of DEM_SETS) {
    const { x, y, px, py } = tileCoords(lat, lon, set.zoom);
    const png = await loadTile(set.name, set.zoom, x, y);
    if (!png) continue;
    const h = decodeElevation(png, px, py);
    if (h !== null) return { h, source: set.label };
  }
  return { h: 0, source: '欠測 (0m とみなす)' };
}

/* -------------------------------------------------------------------- 投影 */

/** route 中心を原点とする局所平面座標。x=東(m), z=南(m)。8km 程度なら誤差は無視できる。 */
function makeProjector(lat0, lon0) {
  const kx = R_EARTH * DEG * Math.cos(lat0 * DEG);
  const kz = R_EARTH * DEG;
  return (lat, lon) => ({
    x: (lon - lon0) * kx,
    z: (lat0 - lat) * kz,
  });
}

/* -------------------------------------------------------------------- 本体 */

function medianFilter(values, window) {
  const half = window >> 1;
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length, i + half + 1);
    const w = values.slice(lo, hi).sort((a, b) => a - b);
    return w[w.length >> 1];
  });
}

function movingAverage(values, window) {
  const half = window >> 1;
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k < 0 || k >= values.length) continue;
      sum += values[k];
      n++;
    }
    return sum / n;
  });
}

const round = (v, d = 2) => Number(v.toFixed(d));

async function main() {
  const route = JSON.parse(readFileSync(SRC, 'utf8'));
  const { points, totalLength } = resample(route.waypoints, STEP_M);
  console.log(`${route.name}: ${points.length} 点 / 実延長 ${(totalLength / 1000).toFixed(3)} km`);

  process.stdout.write('標高タイル取得');
  const sources = new Set();
  const rawElev = [];
  for (const [lat, lon] of points) {
    const { h, source } = await elevationAt(lat, lon);
    rawElev.push(h);
    sources.add(source);
  }
  console.log(` 完了 (${[...sources].join(', ')})`);

  const elev = movingAverage(medianFilter(rawElev, MEDIAN_WINDOW), SMOOTH_WINDOW);

  // 現代の地形が江戸期と大きく異なる箇所への手動補正。
  // 切通し・埋立・造成で失われた起伏を、根拠を明記したうえで戻す。
  for (const ov of route.elevationOverrides ?? []) {
    for (let i = 0; i < points.length; i++) {
      const d = haversine(ov.at, points[i]);
      if (d >= ov.radiusM) continue;
      // 余弦の裾で滑らかに立ち上げる
      elev[i] += ov.raiseM * 0.5 * (1 + Math.cos((d / ov.radiusM) * Math.PI));
    }
  }

  const lat0 = points[0][0];
  const lon0 = points[0][1];
  const project = makeProjector(lat0, lon0);

  const s = [];
  const xs = [];
  const ys = [];
  const zs = [];
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) acc += haversine(points[i - 1], points[i]);
    const p = project(points[i][0], points[i][1]);
    s.push(round(acc, 2));
    xs.push(round(p.x, 2));
    ys.push(round(elev[i], 2));
    zs.push(round(p.z, 2));
  }

  // 勾配 (‰)。中央差分。
  const grade = s.map((_, i) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(s.length - 1, i + 1);
    const ds = s[b] - s[a];
    return ds > 0 ? round(((ys[b] - ys[a]) / ds) * 1000, 1) : 0;
  });

  // ランドマークを最寄りのサンプル点にスナップする。
  const landmarks = route.landmarks.map((lm) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = haversine(lm.at, points[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return {
      ...lm,
      s: s[best],
      x: xs[best],
      y: ys[best],
      z: zs[best],
      snapError: round(bestD, 1),
    };
  });

  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const maxGrade = Math.max(...grade.map(Math.abs));

  const out = {
    meta: {
      id: route.id,
      name: route.name,
      from: route.from,
      to: route.to,
      historicalDistance: route.historicalDistance,
      note: route.note,
      generatedAt: new Date().toISOString().slice(0, 10),
      stepM: STEP_M,
      medianWindow: MEDIAN_WINDOW,
      smoothWindow: SMOOTH_WINDOW,
      elevationSource: [...sources],
      elevationOverrides: route.elevationOverrides ?? [],
      attribution: '標高: 国土地理院 標高タイル',
    },
    origin: { lat: lat0, lon: lon0 },
    totalLength: round(totalLength, 1),
    stats: {
      minElevation: round(minY),
      maxElevation: round(maxY),
      maxGradePermil: maxGrade,
    },
    shoreline: route.shoreline ?? null,
    samples: { s, x: xs, y: ys, z: zs, grade },
    landmarks,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));

  console.log(`標高 ${out.stats.minElevation}m 〜 ${out.stats.maxElevation}m / 最急勾配 ${maxGrade}‰`);
  console.log('里程の照合: 実測 %s km / 史料 %s km (二里)',
    (totalLength / 1000).toFixed(2), route.historicalDistance.km);
  console.log('ランドマークのスナップ誤差 (m):');
  for (const lm of landmarks) {
    console.log(`  ${String(lm.s).padStart(7)}m  ${lm.name}  (誤差 ${lm.snapError}m, 標高 ${lm.y}m)`);
  }
  console.log(`\n-> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
