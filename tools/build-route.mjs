/**
 * 街道データのビルド。
 *
 *   data/routes/*.json (手動デジタイズの緯度経度)
 *     -> 等間隔リサンプル
 *     -> 国土地理院 標高タイルから標高を取得
 *     -> ローカル平面座標へ投影
 *     -> 名所名で書かれた道幅・区間・行列の位置を里程へ解決
 *     -> src/data/<id>.generated.json
 *     -> src/data/routes.generated.json (一覧)
 *
 * 標高タイルは .cache/dem/ にキャッシュするので、二度目以降は通信しない。
 *
 * 出典: 国土地理院 標高タイル (DEM5A / DEM10B)
 *       https://maps.gsi.go.jp/development/ichiran.html
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = resolve(ROOT, 'data/routes');
const OUT_DIR = resolve(ROOT, 'src/data');
const CACHE = resolve(ROOT, '.cache/dem');

/** リサンプル間隔 (m)。 */
const STEP_M = 15;

/**
 * 標高の平滑化。
 * 都市部の DEM は掘割・高架・再開発の造成を拾うため、数十 m 幅のスパイクが出る。
 * まず中央値フィルタでスパイクを落とし、次に移動平均でならす。
 *
 * 窓幅は「消したいスパイクより広く、残したい起伏より狭く」なければならない。
 * 街道の峠は数百 m 続くので既定の 225m でよいが、麻布のように 150m ごとに
 * 谷と台地が入れ替わる道では本物の起伏まで平らにしてしまう。
 * そういう道は route の smoothWindowM で狭められるようにしてある。
 */
const DEFAULT_MEDIAN_M = 75;
const DEFAULT_SMOOTH_M = 225;

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
  const v = png.data[i] * 65536 + png.data[i + 1] * 256 + png.data[i + 2];
  if (v === 0x800000) return null;
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

/** route 起点を原点とする局所平面座標。x=東(m), z=南(m)。10km 程度なら誤差は無視できる。 */
function projectionFor(lat0, lon0) {
  return {
    lat0,
    lon0,
    kx: R_EARTH * DEG * Math.cos(lat0 * DEG),
    kz: R_EARTH * DEG,
  };
}

/* -------------------------------------------------------------------- 補助 */

function medianFilter(values, window) {
  const half = window >> 1;
  return values.map((_, i) => {
    const w = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1))
      .sort((a, b) => a - b);
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

/* -------------------------------------------------------------------- 本体 */

async function buildRoute(file) {
  const route = JSON.parse(readFileSync(file, 'utf8'));
  const { points, totalLength } = resample(route.waypoints, STEP_M);
  console.log(`\n[${route.id}] ${route.road} ${route.name}`);
  console.log(`  ${points.length} 点 / 実延長 ${(totalLength / 1000).toFixed(3)} km`);

  process.stdout.write('  標高タイル取得');
  const sources = new Set();
  const rawElev = [];
  for (const [lat, lon] of points) {
    const { h, source } = await elevationAt(lat, lon);
    rawElev.push(h);
    sources.add(source);
  }
  console.log(` 完了`);

  // 窓幅は m 指定を点数へ直す。必ず奇数にして中心を揃える。
  const toOdd = (m) => {
    const n = Math.max(1, Math.round(m / STEP_M));
    return n % 2 === 1 ? n : n + 1;
  };
  const medianWindow = toOdd(route.medianWindowM ?? DEFAULT_MEDIAN_M);
  const smoothWindow = toOdd(route.smoothWindowM ?? DEFAULT_SMOOTH_M);

  const elev = movingAverage(medianFilter(rawElev, medianWindow), smoothWindow);

  // 現代の地形が江戸期と大きく異なる箇所への手動補正。
  // 切通し・埋立・造成で失われた起伏を、根拠を明記したうえで戻す。
  for (const ov of route.elevationOverrides ?? []) {
    for (let i = 0; i < points.length; i++) {
      const d = haversine(ov.at, points[i]);
      if (d >= ov.radiusM) continue;
      elev[i] += ov.raiseM * 0.5 * (1 + Math.cos((d / ov.radiusM) * Math.PI));
    }
  }

  const projection = projectionFor(points[0][0], points[0][1]);

  const s = [];
  const xs = [];
  const ys = [];
  const zs = [];
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) acc += haversine(points[i - 1], points[i]);
    s.push(round(acc, 2));
    xs.push(round((points[i][1] - projection.lon0) * projection.kx, 2));
    ys.push(round(elev[i], 2));
    zs.push(round((projection.lat0 - points[i][0]) * projection.kz, 2));
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
    return { ...lm, s: s[best], x: xs[best], y: ys[best], z: zs[best], snapError: round(bestD, 1) };
  });

  const byName = new Map(landmarks.map((lm) => [lm.name, lm]));
  const sOf = (name) => {
    if (name === null || name === undefined) return totalLength;
    const lm = byName.get(name);
    if (!lm) throw new Error(`[${route.id}] 名所 "${name}" が見つからない`);
    return lm.s;
  };

  // 名所名で書かれた表を里程へ解決する。
  const width = (route.width ?? []).map((w) => [sOf(w.at), w.m]);
  let from = 0;
  const sections = (route.sections ?? []).map((sec) => {
    const to = sOf(sec.until);
    const out = { ...sec, from, to };
    from = to;
    return out;
  });
  const processions = (route.processions ?? []).map((p) => ({
    ...p,
    center: round(sOf(p.at) + (p.offset ?? 0), 1),
  }));

  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const maxGrade = Math.max(...grade.map(Math.abs));

  const out = {
    meta: {
      id: route.id,
      road: route.road,
      stage: route.stage,
      name: route.name,
      from: route.from,
      to: route.to,
      summary: route.summary,
      historicalDistance: route.historicalDistance,
      note: route.note,
      generatedAt: new Date().toISOString().slice(0, 10),
      stepM: STEP_M,
      medianWindow,
      smoothWindow,
      elevationSource: [...sources],
      elevationOverrides: route.elevationOverrides ?? [],
      attribution: '標高: 国土地理院 標高タイル',
    },
    projection,
    startTimeMinutes: route.startTimeMinutes,
    gate: route.gate ?? null,
    totalLength: round(totalLength, 1),
    stats: { minElevation: round(minY), maxElevation: round(maxY), maxGradePermil: maxGrade },
    width,
    sections,
    processions,
    shoreline: route.shoreline ?? null,
    samples: { s, x: xs, y: ys, z: zs, grade },
    landmarks,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, `${route.id}.generated.json`), JSON.stringify(out));

  console.log(`  標高 ${out.stats.minElevation}m 〜 ${out.stats.maxElevation}m / 最急勾配 ${maxGrade}‰`);
  console.log(`  里程 実測 ${(totalLength / 1000).toFixed(2)} km / 史料 ${route.historicalDistance.km} km`);
  const worst = Math.max(...landmarks.map((l) => l.snapError));
  console.log(`  名所 ${landmarks.length} 箇所 (最大スナップ誤差 ${worst}m)`);
  for (const lm of landmarks) {
    console.log(`    ${String(Math.round(lm.s)).padStart(5)}m  標高 ${String(lm.y).padStart(6)}m  ${lm.name}`);
  }

  return {
    id: route.id,
    road: route.road,
    stage: route.stage,
    order: route.order ?? 99,
    name: route.name,
    from: route.from,
    to: route.to,
    summary: route.summary,
    totalLength: out.totalLength,
    historicalDistance: route.historicalDistance,
    stats: out.stats,
  };
}

async function main() {
  const files = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => resolve(SRC_DIR, f));

  const manifest = [];
  for (const file of files) {
    manifest.push(await buildRoute(file));
  }
  manifest.sort((a, b) => a.order - b.order);

  writeFileSync(
    resolve(OUT_DIR, 'routes.generated.json'),
    JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), routes: manifest }, null, 2)
  );
  console.log(`\n${manifest.length} 街道を出力した -> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
