import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { CROSSING_DEPTH, CROSSING_WATER } from '../core/route.js';
import { makeRng } from '../core/rng.js';
import { mergeGeometries, groundedBox } from '../core/geometry.js';
import { instanced } from './townscape.js';

/**
 * 地面・路面・水面・舟。
 *
 * すべて街道のサンプル点から帯状に押し出して作る。
 * 街道から離れた場所の標高は分からないので、路面高をそのまま延ばし、
 * 汀線の外だけ水面下へ落としている。
 *
 * 地面は左右で別々の帯にしてある。こうすると片側だけ水にする街道
 * （隅田川が右手に来る日光道中など）でも、断面の並びが崩れない。
 */

/** 帯の外縁 (m)。よそ見で霞を払ったときに端が見えない距離。 */
const FAR = 950;

const COLORS = {
  // よそ見で遠くまで見えるようになったぶん、遠景は沈めておかないと
  // 平原が明るく広がって、堀や城の造形が読めなくなる。
  far: new THREE.Color(0x555a41),
  verge: new THREE.Color(0x6b5c40),
  shore: new THREE.Color(0xa89a78),
  sea: new THREE.Color(0x24313c),
};

export function buildTerrain(route, materials) {
  const group = new THREE.Group();
  group.add(buildGroundSide(route, materials, -1));
  group.add(buildGroundSide(route, materials, +1));
  group.add(buildRoad(route, materials));
  for (const water of buildCrossings(route, materials)) group.add(water);
  if (route.hasWater) {
    // 川は帯で、海は一枚の広い水面で作る。
    group.add(route.riverWidth ? buildRiver(route, materials) : buildSea(route, materials));
    const boats = buildBoats(route, materials);
    if (boats) group.add(boats);
    if (route.riverWidth) {
      const bank = buildFarBank(route, materials);
      if (bank) group.add(bank);
    }
  }
  return group;
}

/**
 * 片側の地面。街道際から外へ向かう断面を作る。
 * @param side -1 が進行方向の右、+1 が左
 */
function buildGroundSide(route, materials, side) {
  const n = route.count;
  const withWater = route.hasWater && route.waterSide === side;
  const river = withWater ? route.riverWidth : null;
  const cols = withWater ? (river ? 7 : 4) : 3;

  const pos = new Float32Array(n * cols * 3);
  const col = new Float32Array(n * cols * 3);
  const rng = makeRng(20250815 + (side > 0 ? 1 : 0));
  const sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };

  for (let i = 0; i < n; i++) {
    const s = route.s[i];
    route.sample(s, 0, sample);
    const roadY = sample.pos.y - route.crossingDropAt(s);
    const half = route.widthAt(s) / 2;
    // 路面と少し重ねて隙間を作らない
    const inner = half - 0.3;

    // 水の見えない区間では水の列を陸の端へ畳んでしまう。
    // 列の数は帯じゅうで揃っていないといけないので、消すのではなく重ねる。
    const dry = withWater && !route.waterVisibleAt(s);

    let spec;
    if (dry) {
      const edge = { d: FAR, y: roadY, kind: 'far' };
      spec = [{ d: inner, y: roadY - 0.12, kind: 'verge' }, { d: 280, y: roadY, kind: 'far' }];
      while (spec.length < cols) spec.push(edge);
    } else if (withWater && river) {
      // 川。対岸を立ち上げて向こう岸を見せる。
      // 川が見えない区間では川幅を絞り、干上がった溝が残らないようにする。
      const shore = Math.max(inner + 16, route.shoreOffsetAt(s));
      const t = Math.min(1, Math.max(0, (350 - shore) / 100));
      const bankY = Math.min(roadY, 0.8);
      const bedY = bankY + (-2.5 - bankY) * t;
      const rw = river * t;
      spec = [
        { d: inner, y: roadY - 0.12, kind: 'verge' },
        { d: Math.min(FAR, shore * 0.55), y: roadY, kind: 'far' },
        { d: shore, y: bankY, kind: 'shore' },
        { d: shore + 12, y: bedY, kind: 'sea' },
        { d: shore + Math.max(24, rw - 12), y: bedY, kind: 'sea' },
        { d: shore + Math.max(36, rw), y: bankY + 0.3, kind: 'shore' },
        { d: shore + Math.max(36, rw) + 320, y: bankY + 1.6, kind: 'far' },
      ];
    } else if (withWater) {
      const shore = Math.max(inner + 16, route.shoreOffsetAt(s));
      spec = [
        { d: inner, y: roadY - 0.12, kind: 'verge' },
        { d: Math.min(FAR, shore * 0.55), y: roadY, kind: 'far' },
        { d: shore, y: Math.min(roadY, 0.8), kind: 'shore' },
        { d: shore + 60, y: -3.0, kind: 'sea' },
      ];
    } else {
      spec = [
        { d: inner, y: roadY - 0.12, kind: 'verge' },
        { d: 280, y: roadY, kind: 'far' },
        { d: FAR, y: roadY, kind: 'far' },
      ];
    }

    for (let c = 0; c < cols; c++) {
      const u = side * spec[c].d;
      // 遠景はわずかに起伏させて板に見えないようにする
      const y = spec[c].kind === 'far' ? spec[c].y + (rng() - 0.5) * 1.8 - 0.4 : spec[c].y;

      const o = (i * cols + c) * 3;
      pos[o] = sample.pos.x + sample.left.x * u;
      pos[o + 1] = y;
      pos[o + 2] = sample.pos.z + sample.left.z * u;

      const cc = COLORS[spec[c].kind];
      const shade = 0.9 + rng() * 0.2;
      col[o] = cc.r * shade;
      col[o + 1] = cc.g * shade;
      col[o + 2] = cc.b * shade;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // 左右で列の並ぶ向きが逆になるので、巻き方向も入れ替える
  geo.setIndex(gridIndices(n, cols, side > 0));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, materials.ground);
  mesh.name = `ground${side > 0 ? 'L' : 'R'}`;
  return mesh;
}

/**
 * 渡しの水面。
 *
 * 街道を横切って流れる川。海や沿いの川と違って向こう岸が街道の先にあるので、
 * 帯ではなく街道を跨ぐ一枚の板で張る。
 */
function buildCrossings(route, materials) {
  const out = [];
  const sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };

  for (const c of route.crossings) {
    const rows = [];
    for (let s = c.near - 6; s <= c.far + 6; s += 12) rows.push(Math.min(s, route.length));

    const cols = 2;
    const pos = new Float32Array(rows.length * cols * 3);
    let bedY = Infinity;
    for (const s of rows) {
      route.sample(s, 0, sample);
      bedY = Math.min(bedY, sample.pos.y - CROSSING_DEPTH);
    }

    for (let i = 0; i < rows.length; i++) {
      route.sample(rows[i], 0, sample);
      for (let col = 0; col < cols; col++) {
        const u = (col === 0 ? -1 : 1) * 700;
        const o = (i * cols + col) * 3;
        pos[o] = sample.pos.x + sample.left.x * u;
        pos[o + 1] = bedY + CROSSING_WATER;
        pos[o + 2] = sample.pos.z + sample.left.z * u;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(gridIndices(rows.length, cols, true));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, materials.sea);
    mesh.name = `crossing:${c.at}`;
    out.push(mesh);
  }
  return out;
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
  // 渡しの上には道が無い。舟で越えるところなので路面を抜く。
  geo.setIndex(gridIndices(n, cols, true, (i) => route.crossingAt(route.s[i]) !== null));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, materials.road);
  mesh.name = 'road';
  return mesh;
}

/**
 * 海面。汀線から沖へ向かって帯で張る。
 *
 * 以前は街道じゅうを覆う一枚板だったが、それだと内陸へ入った区間
 * （六郷の渡しのあたりなど）にも海が敷かれてしまう。水の見えない
 * 区間では二列を重ねて幅を殺し、海が湧かないようにする。
 */
function buildSea(route, materials) {
  const n = route.count;
  const cols = 2;
  const pos = new Float32Array(n * cols * 3);
  const sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };
  const side = route.waterSide;

  for (let i = 0; i < n; i++) {
    const s = route.s[i];
    route.sample(s, 0, sample);
    const inner = route.widthAt(s) / 2 - 0.3;
    const shore = Math.max(inner + 16, route.shoreOffsetAt(s));
    // 沖は霞の先まで。水平線は霞に溶けるので、これ以上は要らない。
    const offsets = route.waterVisibleAt(s) ? [shore + 18, shore + 3200] : [shore, shore];

    for (let c = 0; c < cols; c++) {
      const u = side * offsets[c];
      const o = (i * cols + c) * 3;
      pos[o] = sample.pos.x + sample.left.x * u;
      pos[o + 1] = 0.25;
      pos[o + 2] = sample.pos.z + sample.left.z * u;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(gridIndices(n, cols, true));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, materials.sea);
  mesh.name = 'sea';
  mesh.renderOrder = -1;
  return mesh;
}

/** 川面。街道に沿って帯で張る。海と違って向こう岸があるので一枚板にはしない。 */
function buildRiver(route, materials) {
  const n = route.count;
  const cols = 2;
  const pos = new Float32Array(n * cols * 3);
  const sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };
  const side = route.waterSide;

  for (let i = 0; i < n; i++) {
    const s = route.s[i];
    route.sample(s, 0, sample);
    const inner = route.widthAt(s) / 2 - 0.3;
    const shore = Math.max(inner + 16, route.shoreOffsetAt(s));
    const t = route.waterVisibleAt(s) ? Math.min(1, Math.max(0, (350 - shore) / 100)) : 0;
    const rw = route.riverWidth * t;

    const offsets = [shore + 4, shore + Math.max(4, rw - 4)];
    for (let c = 0; c < cols; c++) {
      const u = side * offsets[c];
      const o = (i * cols + c) * 3;
      pos[o] = sample.pos.x + sample.left.x * u;
      pos[o + 1] = 0.4;
      pos[o + 2] = sample.pos.z + sample.left.z * u;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(gridIndices(n, cols, side > 0));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, materials.sea);
  mesh.name = 'river';
  return mesh;
}

/**
 * 対岸の木立。
 * 平らな土手だけでは向こう岸が読めないので、木を並べて岸の高さを示す。
 * 隅田川の東は向島。土手に桜と松が続き、寺社の森が点々とあった。
 */
function buildFarBank(route, materials) {
  const rng = makeRng(1774);
  const trunks = [];
  const crowns = [];
  const sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };
  const side = route.waterSide;

  for (let s = 0; s < route.length; s += rng.range(14, 34)) {
    const shore = route.shoreOffsetAt(s);
    if (shore > 300) continue;
    const t = Math.min(1, Math.max(0, (350 - shore) / 100));
    if (t < 0.5) continue;

    route.sample(s, 0, sample);
    const u = side * (shore + route.riverWidth * t + rng.range(4, 130));
    const base = new THREE.Vector3(
      sample.pos.x + sample.left.x * u,
      0.9,
      sample.pos.z + sample.left.z * u
    );
    const h = rng.range(8, 15);
    const yaw = rng() * Math.PI * 2;
    trunks.push({
      pos: base,
      yaw,
      scale: new THREE.Vector3(0.45, h * 0.6, 0.45),
      color: new THREE.Color(PALETTE.ki).multiplyScalar(rng.range(0.7, 1.0)),
    });
    crowns.push({
      pos: new THREE.Vector3(base.x, base.y + h * 0.6, base.z),
      yaw,
      scale: new THREE.Vector3(rng.range(4, 7), h * rng.range(0.5, 0.7), rng.range(4, 7)),
      color: new THREE.Color(PALETTE.matsuba).multiplyScalar(rng.range(0.6, 1.0)),
    });
  }

  if (!trunks.length) return null;
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.55, 1, 1, 5, 1);
  trunkGeo.translate(0, 0.5, 0);
  group.add(instanced(trunkGeo, materials.wood, trunks));
  group.add(instanced(new THREE.IcosahedronGeometry(0.5, 1), materials.foliage, crowns));
  group.name = 'farBank';
  return group;
}

/** 沖の弁才船。江戸湾は江戸の台所で、廻船が絶えず行き来していた。 */
function buildBoats(route, materials) {
  const rng = makeRng(1750);
  const hulls = [];
  const sails = [];
  const sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };

  const spread = route.riverWidth ? [30, route.riverWidth - 30] : [60, 520];

  for (let s = 0; s < route.length; s += 190) {
    if (!route.waterVisibleAt(s)) continue; // 水が見えない区間
    const shore = route.shoreOffsetAt(s);
    if (shore > 300) continue;
    if (rng.chance(0.45)) continue;

    route.sample(s + rng.range(-60, 60), 0, sample);
    const u = route.waterSide * (shore + rng.range(spread[0], spread[1]));
    const pos = new THREE.Vector3(
      sample.pos.x + sample.left.x * u,
      0.25,
      sample.pos.z + sample.left.z * u
    );
    const scale = rng.range(0.75, 1.5);
    const yaw = rng() * Math.PI * 2;
    hulls.push({ pos, yaw, scale: new THREE.Vector3(scale, scale, scale) });
    sails.push({ pos: pos.clone(), yaw, scale: new THREE.Vector3(scale, scale, scale) });
  }

  if (!hulls.length) return null;
  const group = new THREE.Group();
  group.add(instanced(hullGeometry(), materials.deck, hulls));
  group.add(instanced(sailGeometry(), materials.sail, sails));
  group.name = 'boats';
  return group;
}

function hullGeometry() {
  return mergeGeometries([
    groundedBox(3.2, 1.4, 11, 0, -0.5, 0),
    groundedBox(2.2, 0.9, 3.4, 0, 0.9, -3.2), // 船尾の屋形
    groundedBox(0.34, 9.5, 0.34, 0, 0.9, 0.6), // 帆柱
  ]);
}

/** 一枚帆。弁才船の帆は白木綿を継いだ大きな四角帆。 */
function sailGeometry() {
  const g = new THREE.PlaneGeometry(6.4, 7.6);
  g.translate(0, 5.6, 0.6);
  return g;
}

/** rows×cols の格子の三角形添字。法線が +Y を向く巻き方向。 */
function gridIndices(rows, cols, forward, skipRow) {
  const idx = [];
  for (let i = 0; i < rows - 1; i++) {
    if (skipRow && (skipRow(i) || skipRow(i + 1))) continue;
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      if (forward) idx.push(a, d, b, b, d, e);
      else idx.push(a, b, d, b, e, d);
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

/** 土の路面のテクスチャ。踏み固められた土。 */
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
