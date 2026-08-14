import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { makeRng } from '../core/rng.js';
import { WORLD_SEED } from '../core/config.js';
import { mergeGeometries, roofPrism } from '../core/geometry.js';

/**
 * 沿道の町並み。
 *
 * 里程によって景色を変える。日本橋から芝口までは間口の狭い町家が隙間なく並び、
 * 高輪大木戸を出ると江戸の外なので松並木と茶屋になり、
 * 八ツ山を下ると再び宿場の旅籠が建て込む。
 *
 * 一軒は「躯体・屋根・軒・店構え・暖簾」の五つの部品でできている。
 * それぞれ InstancedMesh 一つにまとめるので、千軒建てても描画は五回で済む。
 */

const SECTIONS = [
  { from: 0, to: 2505, kind: 'machiya', spacing: 6.5, gap: 0.05, storeys: 2 },
  { from: 2505, to: 4245, kind: 'machiya', spacing: 8.0, gap: 0.14, storeys: 2 },
  { from: 4245, to: 5639, kind: 'yashiki', spacing: 13, gap: 0.22, storeys: 1 },
  { from: 5639, to: 7379, kind: 'kaido', spacing: 22, gap: 0.5, storeys: 1 },
  { from: 7379, to: 99999, kind: 'shuku', spacing: 6.0, gap: 0.04, storeys: 2 },
];

const WALL_COLORS = [0xcabb9c, 0xbdaf92, 0xae9f83, 0xd2c4a6, 0xb6a98f];
const ROOF_COLORS = [0x3f434a, 0x494d54, 0x55503f, 0x383c42, 0x635842];
const NOREN_COLORS = [0x2c4a72, 0x8f3a28, 0x2f3a33, 0x574063, 0x7a5a26];

export function buildTownscape(route, materials) {
  const rng = makeRng(WORLD_SEED);
  const group = new THREE.Group();

  const parts = { bodies: [], roofs: [], eaves: [], fronts: [], norens: [], pines: [] };
  const sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };
  const nearLandmark = (s) => route.landmarks.some((lm) => Math.abs(lm.s - s) < 26);

  for (const sec of SECTIONS) {
    const to = Math.min(sec.to, route.length);
    for (let s = sec.from; s < to; s += sec.spacing) {
      for (const side of [-1, 1]) {
        const half = route.widthAt(s) / 2;
        const shore = route.shoreOffsetAt(s);
        // 街道の東は汀線が近ければ建てられない
        if (side > 0 && shore < half + 22 && rng.chance(0.85)) continue;
        if (rng.chance(sec.gap)) continue;
        if (nearLandmark(s)) continue;

        route.sample(s + rng.range(-1.2, 1.2), 0, sample);

        if (sec.kind === 'kaido') {
          // 松と茶屋を同じ場所に立てない
          if (rng.chance(0.3)) {
            addBuilding(parts, sample, side, half, rng, {
              storeys: 1, width: [4.5, 7], depth: [5, 7], setback: [3.5, 6], shop: true,
            });
          } else {
            parts.pines.push(makePine(sample, side, half, rng));
          }
          continue;
        }

        const spec =
          sec.kind === 'yashiki'
            ? { storeys: 1, width: [9, 18], depth: [7, 12], setback: [2.5, 5.5], shop: false }
            : sec.kind === 'shuku'
              ? { storeys: 2, width: [4, 7], depth: [7, 11], shop: true }
              : { storeys: sec.storeys, width: [3.4, 6.4], depth: [6, 11], shop: true };

        const built = addBuilding(parts, sample, side, half, rng, spec);

        // 裏手にもう一列。通りの切れ目から野が見えるのを防ぐ。
        if (sec.kind !== 'kaido' && rng.chance(0.72)) {
          addBuilding(parts, sample, side, half, rng, {
            storeys: rng.chance(0.4) ? 2 : 1,
            width: [5, 10],
            depth: [6, 10],
            setback: [built.reach + 1.5, built.reach + 5],
            shop: false,
          });
        }

        if (sec.kind === 'machiya' && rng.chance(0.08)) {
          parts.pines.push(makePine(sample, side, half, rng));
        }
      }
    }
  }

  group.add(instanced(bodyGeometry(), materials.building, parts.bodies));
  group.add(instanced(roofPrism(), materials.roof, parts.roofs));
  group.add(instanced(bodyGeometry(), materials.eaves, parts.eaves));
  group.add(instanced(bodyGeometry(), materials.shopfront, parts.fronts));
  group.add(instanced(bodyGeometry(), materials.noren, parts.norens));
  if (parts.pines.length) {
    group.add(instanced(pineTrunkGeometry(), materials.wood, parts.pines.map((p) => p.trunk)));
    group.add(instanced(pineFoliageGeometry(), materials.foliage, parts.pines.map((p) => p.foliage)));
  }
  return group;
}

/* ------------------------------------------------------------------ 部品 */

/**
 * 一軒建てる。
 * @returns {{reach:number}} 街道中心からこの家の裏側までの距離。裏の列を置くのに使う。
 */
function addBuilding(parts, sample, side, half, rng, spec) {
  const w = rng.range(spec.width[0], spec.width[1]);
  const d = rng.range(spec.depth[0], spec.depth[1]);
  const storeyH = rng.range(2.5, 3.05);
  const h = spec.storeys === 2 ? storeyH * 2 - rng.range(0.2, 0.6) : storeyH * rng.range(0.85, 1.05);

  const setbackRange = spec.setback ?? [0.5, 1.4];
  const setback = rng.range(setbackRange[0], setbackRange[1]);
  const u = side * (half + setback + d / 2);

  const yaw = Math.atan2(-sample.tangent.z, sample.tangent.x);
  const base = new THREE.Vector3(
    sample.pos.x + sample.left.x * u,
    sample.pos.y - 0.1,
    sample.pos.z + sample.left.z * u
  );
  // 街道を向く面へ向かう向き
  const toRoad = new THREE.Vector3(sample.left.x, 0, sample.left.z).multiplyScalar(-side);

  const wall = new THREE.Color(WALL_COLORS[rng.int(0, WALL_COLORS.length - 1)]);
  const roof = new THREE.Color(ROOF_COLORS[rng.int(0, ROOF_COLORS.length - 1)]);

  parts.bodies.push({ pos: base, yaw, scale: new THREE.Vector3(w, h, d), color: wall });

  parts.roofs.push({
    pos: base.clone().setY(base.y + h),
    yaw,
    scale: new THREE.Vector3(w * 1.22, d * rng.range(0.26, 0.34), d * 1.16),
    color: roof,
  });

  // 軒 — 屋根の下に一本影の線を入れる。屋根の出より内側に収める。
  parts.eaves.push({
    pos: base.clone().setY(base.y + h - 0.09),
    yaw,
    scale: new THREE.Vector3(w * 1.2, 0.18, d * 1.12),
  });

  if (spec.shop) {
    // 腰壁と格子。店は道にぴたりと面する。
    parts.fronts.push({
      pos: base.clone().addScaledVector(toRoad, d / 2 + 0.06).setY(base.y + h * 0.24),
      yaw,
      scale: new THREE.Vector3(w * 0.97, h * 0.48, 0.14),
    });

    if (rng.chance(0.62)) {
      // 暖簾は店口の上端に垂らす
      parts.norens.push({
        pos: base.clone().addScaledVector(toRoad, d / 2 + 0.14).setY(base.y + h * 0.39),
        yaw,
        scale: new THREE.Vector3(w * rng.range(0.6, 0.82), rng.range(0.42, 0.6), 0.08),
        color: new THREE.Color(NOREN_COLORS[rng.int(0, NOREN_COLORS.length - 1)]),
      });
    }

    if (spec.storeys === 2) {
      // 一階と二階のあいだの庇。出は 80cm ほど。
      parts.eaves.push({
        pos: base.clone().addScaledVector(toRoad, d / 2 + 0.28).setY(base.y + h * 0.5),
        yaw,
        scale: new THREE.Vector3(w * 1.05, 0.13, 0.8),
      });
    }
  }

  return { reach: setback + d };
}

function makePine(sample, side, half, rng) {
  const u = side * (half + rng.range(2.0, 4.5));
  const base = new THREE.Vector3(
    sample.pos.x + sample.left.x * u,
    sample.pos.y - 0.1,
    sample.pos.z + sample.left.z * u
  );
  const h = rng.range(7.5, 12.5);
  const yaw = rng() * Math.PI * 2;
  return {
    trunk: {
      pos: base,
      yaw,
      // 幹の先は葉に隠れる長さで止める
      scale: new THREE.Vector3(rng.range(0.34, 0.5), h * 0.68, rng.range(0.34, 0.5)),
      color: new THREE.Color(PALETTE.ki).multiplyScalar(rng.range(0.75, 1.0)),
    },
    foliage: {
      pos: new THREE.Vector3(base.x, base.y + h * 0.58, base.z),
      yaw,
      scale: new THREE.Vector3(rng.range(4.0, 6.4), h * rng.range(0.46, 0.6), rng.range(4.0, 6.4)),
      color: new THREE.Color(PALETTE.matsuba).multiplyScalar(rng.range(0.7, 1.15)),
    },
  };
}

/* -------------------------------------------------------------- 形状の素 */

function bodyGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

function pineTrunkGeometry() {
  const g = new THREE.CylinderGeometry(0.55, 1, 1, 6, 1);
  g.translate(0, 0.5, 0);
  return g;
}

/**
 * 松の葉。杉のような円錐ではなく、平たい塊を段違いに重ねる。
 * 街道の松は幹が曲がり、葉が層になって横に張り出す。
 */
function pineFoliageGeometry() {
  const parts = [];
  for (const l of [
    { y: 0.0, r: 0.56, h: 0.24, x: -0.08, z: 0.05 },
    { y: 0.2, r: 0.48, h: 0.22, x: 0.1, z: -0.06 },
    { y: 0.42, r: 0.36, h: 0.2, x: -0.05, z: -0.02 },
    { y: 0.62, r: 0.22, h: 0.18, x: 0.04, z: 0.04 },
  ]) {
    const c = new THREE.ConeGeometry(l.r, l.h, 7, 1);
    c.scale(1, 1, 1);
    c.translate(l.x, l.y + l.h / 2, l.z);
    parts.push(c);
  }
  return mergeGeometries(parts);
}

/* ------------------------------------------------------------ 実体化 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export function instanced(geometry, material, items) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    _q.setFromAxisAngle(_up, it.yaw ?? 0);
    _m.compose(it.pos, _q, it.scale);
    mesh.setMatrixAt(i, _m);
    if (it.color) mesh.setColorAt(i, it.color);
  }
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}
