/**
 * 小地図のもとになる現代地図の切り出し。
 *
 *   src/data/*.generated.json の街道の範囲
 *     -> 国土地理院 淡色地図タイル (zoom 15) を取得して継ぎ合わせ
 *     -> 街道の範囲＋余白で切り出し
 *     -> public/maps/<id>.png と public/maps/index.json
 *
 * ゲームは公開後もローカルだけで動くので、実行時に通信はしない。
 * タイルは .cache/pale/ にキャッシュする。
 *
 * 出典: 国土地理院 淡色地図タイル
 *       https://maps.gsi.go.jp/development/ichiran.html
 * 表示側に「地理院タイル」の出典表示を出すこと。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = resolve(ROOT, 'src/data');
const OUT_DIR = resolve(ROOT, 'public/maps');
const CACHE = resolve(ROOT, '.cache/pale');

const TILESET = 'pale';
const ZOOM = 15;
const TILE = 256;
/** 切り出しの余白 (px)。小地図の窓の半分より大きくとる。 */
const MARGIN_PX = 130;
/** 各チャンネルの階調数。地図は平坦色ばかりなので落としても見分けがつかない。 */
const POSTERIZE_LEVELS = 12;

const DEG = Math.PI / 180;

/* --------------------------------------------------------- 地図座標 */

/** 緯度経度 -> ズーム z の世界ピクセル座標 (Web メルカトル)。 */
function toWorldPx(lat, lon, z) {
  const world = TILE * 2 ** z;
  const latRad = lat * DEG;
  return {
    x: ((lon + 180) / 360) * world,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * world,
  };
}

/* ------------------------------------------------------------ タイル */

async function fetchTile(x, y) {
  const file = resolve(CACHE, `${ZOOM}/${x}/${y}.png`);
  if (existsSync(file)) return PNG.sync.read(readFileSync(file));

  const url = `https://cyberjapandata.gsi.go.jp/xyz/${TILESET}/${ZOOM}/${x}/${y}.png`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`${url} -> HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
  process.stdout.write('.');
  return PNG.sync.read(buf);
}

/** 階調を落とす。同じ色の面が増えるほど PNG の圧縮が効く。 */
function posterize(png, levels) {
  const step = 255 / (levels - 1);
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.round(v / step) * step);
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = lut[png.data[i]];
    png.data[i + 1] = lut[png.data[i + 1]];
    png.data[i + 2] = lut[png.data[i + 2]];
    png.data[i + 3] = 255;
  }
}

/* -------------------------------------------------------------- 本体 */

async function buildMap(route) {
  // 街道の全サンプルを含む矩形を求める
  const { projection, samples } = route;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < samples.s.length; i++) {
    const lat = projection.lat0 - samples.z[i] / projection.kz;
    const lon = projection.lon0 + samples.x[i] / projection.kx;
    const p = toWorldPx(lat, lon, ZOOM);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const cropX = Math.floor(minX - MARGIN_PX);
  const cropY = Math.floor(minY - MARGIN_PX);
  const cropW = Math.ceil(maxX + MARGIN_PX) - cropX;
  const cropH = Math.ceil(maxY + MARGIN_PX) - cropY;

  const tx0 = Math.floor(cropX / TILE);
  const ty0 = Math.floor(cropY / TILE);
  const tx1 = Math.floor((cropX + cropW - 1) / TILE);
  const ty1 = Math.floor((cropY + cropH - 1) / TILE);
  const cols = tx1 - tx0 + 1;
  const rows = ty1 - ty0 + 1;

  process.stdout.write(`  ${cols}x${rows} タイル取得`);
  const sheet = new PNG({ width: cols * TILE, height: rows * TILE });
  // 取得できなかったタイルは白で埋める
  sheet.data.fill(0xff);

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const tile = await fetchTile(tx, ty);
      if (!tile) continue;
      PNG.bitblt(tile, sheet, 0, 0, TILE, TILE, (tx - tx0) * TILE, (ty - ty0) * TILE);
    }
  }
  console.log(' 完了');

  const out = new PNG({ width: cropW, height: cropH });
  PNG.bitblt(sheet, out, cropX - tx0 * TILE, cropY - ty0 * TILE, cropW, cropH, 0, 0);
  posterize(out, POSTERIZE_LEVELS);

  mkdirSync(OUT_DIR, { recursive: true });
  const file = resolve(OUT_DIR, `${route.meta.id}.png`);
  // 淡色地図はほぼ平坦色なので、階調を落とすと見た目を保ったまま大きく縮む。
  // アルファは使わないので colorType 2 (RGB) で書き出す。
  const buf = PNG.sync.write(out, { deflateLevel: 9, colorType: 2, inputHasAlpha: true });
  writeFileSync(file, buf);

  console.log(`  ${cropW}x${cropH}px / ${(buf.length / 1024).toFixed(0)} KB -> ${file}`);

  return {
    id: route.meta.id,
    image: `maps/${route.meta.id}.png`,
    zoom: ZOOM,
    tileSize: TILE,
    originPx: { x: cropX, y: cropY },
    size: { w: cropW, h: cropH },
    attribution: '地理院タイル',
  };
}

async function main() {
  const files = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.generated.json') && f !== 'routes.generated.json')
    .sort();

  const index = {};
  for (const f of files) {
    const route = JSON.parse(readFileSync(resolve(DATA_DIR, f), 'utf8'));
    console.log(`\n[${route.meta.id}] ${route.meta.road} ${route.meta.name}`);
    index[route.meta.id] = await buildMap(route);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`\n${Object.keys(index).length} 枚を出力した -> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
