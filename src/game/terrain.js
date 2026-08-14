import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { makeRng } from '../core/rng.js';

/**
 * 地面・路面・海。
 * すべて街道のサンプル点から帯状に押し出して作る。
 * 街道から離れた場所の標高は分からないので、路面高をそのまま延ばし、
 * 汀線の外だけ水面下へ落としている。霞(fog)の外は見えないので破綻しない。
 */

/**
 * 地面の帯の断面を里程ごとに決める。u は街道中心からの横ずれ (m)。負が西、正が東。
 * u は必ず昇順でなければならない。汀線が近い高輪あたりでは東の遠景列を汀線の内側へ寄せる。
 */
const GROUND_COLUMN_COUNT = 7;

function groundColumns(route, s, roadY, out) {
  const half = route.widthAt(s) / 2;
  const shore = Math.max(half + 16, route.shoreOffsetAt(s));
  const eastMid = Math.min(110, shore * 0.55);

  out[0] = { u: -360, y: roadY, kind: 'far' };
  out[1] = { u: -110, y: roadY, kind: 'far' };
  out[2] = { u: -(half + 1.2), y: roadY - 0.15, kind: 'verge' };
  out[3] = { u: half + 1.2, y: roadY - 0.15, kind: 'verge' };
  out[4] = { u: eastMid, y: roadY, kind: 'far' };
  out[5] = { u: shore, y: Math.min(roadY, 0.8), kind: 'shore' };
  out[6] = { u: shore + 45, y: -3.0, kind: 'sea' };
  return out;
}

const COLORS = {
  far: new THREE.Color(0x6f7052),
  verge: new THREE.Color(0x7d6a49),
  shore: new THREE.Color(0xa89a78),
  sea: new THREE.Color(0x24313c),
};

export function buildTerrain(route, materials) {
  const group = new THREE.Group();
  group.add(buildGround(route, materials));
  group.add(buildRoad(route, materials));
  group.add(buildSea(route, materials));
  return group;
}

function buildGround(route, materials) {
  const n = route.count;
  const cols = GROUND_COLUMN_COUNT;
  const pos = new Float32Array(n * cols * 3);
  const col = new Float32Array(n * cols * 3);
  const rng = makeRng(20250815);

  const sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };
  const spec = new Array(cols);

  for (let i = 0; i < n; i++) {
    const s = route.s[i];
    route.sample(s, 0, sample);
    groundColumns(route, s, sample.pos.y, spec);

    for (let c = 0; c < cols; c++) {
      const { u, kind } = spec[c];
      // 遠景はわずかに起伏させて板に見えないようにする
      const y = kind === 'far' ? spec[c].y + (rng() - 0.5) * 1.6 - 0.4 : spec[c].y;

      const o = (i * cols + c) * 3;
      pos[o] = sample.pos.x + sample.left.x * u;
      pos[o + 1] = y;
      pos[o + 2] = sample.pos.z + sample.left.z * u;

      const cc = COLORS[kind];
      const shade = 0.9 + rng() * 0.2;
      col[o] = cc.r * shade;
      col[o + 1] = cc.g * shade;
      col[o + 2] = cc.b * shade;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(gridIndices(n, cols));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, materials.ground);
  mesh.name = 'ground';
  return mesh;
}

function buildRoad(route, materials) {
  const n = route.count;
  const cols = 4;
  const pos = new Float32Array(n * cols * 3);
  const uv = new Float32Array(n * cols * 2);
  const sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };

  for (let i = 0; i < n; i++) {
    const s = route.s[i];
    route.sample(s, 0, sample);
    const half = route.widthAt(s) / 2;
    // 路面はわずかに蒲鉾状に盛る (水はけ)
    const offsets = [-half, -half * 0.34, half * 0.34, half];
    const lifts = [0.0, 0.09, 0.09, 0.0];

    for (let c = 0; c < cols; c++) {
      const o = (i * cols + c) * 3;
      const u = offsets[c];
      pos[o] = sample.pos.x + sample.left.x * u;
      pos[o + 1] = sample.pos.y + 0.07 + lifts[c];
      pos[o + 2] = sample.pos.z + sample.left.z * u;

      // 縦横で同じ縮尺にしないと轍が引き伸ばされる
      const t = (i * cols + c) * 2;
      uv[t] = u / 6;
      uv[t + 1] = s / 6;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(gridIndices(n, cols));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, materials.road);
  mesh.name = 'road';
  return mesh;
}

function buildSea(route, materials) {
  // 街道全体を覆う一枚の水面。陸の帯が汀線の外で水面下へ落ちるので、
  // 海の見えない区間では陸に隠れる。
  const geo = new THREE.PlaneGeometry(6000, 12000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, materials.sea);
  const mid = route.sample(route.length / 2, 0);
  mesh.position.set(mid.pos.x + 1200, 0.25, mid.pos.z);
  mesh.name = 'sea';
  mesh.renderOrder = -1;
  return mesh;
}

/** rows×cols の格子の三角形添字。法線が +Y を向く巻き方向。 */
function gridIndices(rows, cols) {
  const idx = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  return idx;
}

/** 波頭を描いた海のテクスチャ。広重の海は線で刷られている。 */
export function makeSeaTexture() {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = '#20344d';
  g.fillRect(0, 0, size, size);

  const rng = makeRng(1833);
  g.lineCap = 'round';
  for (let k = 0; k < 26; k++) {
    const y = rng() * size;
    const w = rng.range(18, 70);
    const x = rng() * size;
    g.strokeStyle = `rgba(198, 219, 235, ${rng.range(0.18, 0.5).toFixed(2)})`;
    g.lineWidth = rng.range(1, 2.4);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + w / 2, y - rng.range(2, 6), x + w, y);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  // canvas の色は sRGB。指定しないとリニアとして扱われて白く浮く。
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(220, 440);
  return tex;
}

/** 土の路面のテクスチャ。轍と踏み固めの筋。 */
export function makeRoadTexture() {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = '#9c8259';
  g.fillRect(0, 0, size, size);

  const rng = makeRng(1601);
  for (let k = 0; k < 260; k++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = rng.range(1, 5);
    g.fillStyle = rng.chance(0.5)
      ? `rgba(112, 91, 62, ${rng.range(0.15, 0.4).toFixed(2)})`
      : `rgba(176, 156, 120, ${rng.range(0.1, 0.3).toFixed(2)})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  return tex;
}
