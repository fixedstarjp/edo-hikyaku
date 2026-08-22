import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { makeRng } from '../core/rng.js';
import { WORLD_SEED } from '../core/config.js';
import { mergeGeometries, roofPrism, groundedBox } from '../core/geometry.js';

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

/**
 * 町の色。
 *
 * 江戸の町家は白い町ではない。柱も板壁も雨と日に灼けて煤けた茶になり、
 * そこへ土蔵と塗屋の白漆喰がとびとびに混じる。壁を生成り一色で塗ると
 * 明るい南欧の町になってしまうので、板壁を主にして漆喰を差し色に回す。
 */
const WALL_TIMBER = [0x8b7357, 0x977f62, 0x7d6a52, 0x9d8464, 0x87715a, 0x917a5e];
const WALL_PLASTER = [0xdcd3bd, 0xd2c8b0, 0xe5dcc7];
/** 立て看板の板。日に灼けた白木。 */
const KANBAN_COLORS = [0xc3ae8a, 0xb5a07d, 0xcdb994];
const ROOF_KAWARA = [0x4a4e56, 0x545860, 0x3f434a, 0x585c63, 0x44474d];
/** 茅と板葺き。瓦は町場の作りで、在方では茅のほうが多い。 */
const ROOF_KAYA = [0x9b8659, 0xa89265, 0x8c7950, 0xb19b6d];
/** 暖簾は藍と柿渋が主。日除けの大暖簾は晒しの生成り。 */
const NOREN_COLORS = [0x2c4a72, 0x8f3a28, 0x2f3a33, 0x574063, 0x7a5a26, 0x1f3a5c];
const HIYOKE_COLORS = [0xded3ba, 0xd5c9ae, 0xe4dac4];

const pick = (list, rng) => list[rng.int(0, list.length - 1)];

export function buildTownscape(route, materials) {
  const rng = makeRng(WORLD_SEED);
  const group = new THREE.Group();

  // 用水の溝は町の片側だけに掘る。どちら側かは宿によって違うので籤で決める。
  const gutterSide = rng.chance(0.5) ? -1 : 1;

  const parts = {
    bodies: [], roofs: [], eaves: [], fronts: [], norens: [], pines: [],
    torii: [], shrines: [], yagura: [], stalls: [], stallRoofs: [], kura: [],
  };
  const sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };
  const clearZones = keepClearZones(route);
  const blocked = (s, side) =>
    clearZones.some((z) => s > z.from && s < z.to && (z.side === 0 || z.side === side));

  // 渡しは川。水の上にも河原にも町は無い。
  const overWater = (s) => route.crossingDropAt(s) > 0.25;

  for (const sec of route.sections) {
    const to = Math.min(sec.to, route.length);
    for (let s = sec.from; s < to; s += sec.spacing) {
      for (const side of [-1, 1]) {
        const half = route.widthAt(s) / 2;
        const shore = route.shoreOffsetAt(s);
        // 街道の東は汀線が近ければ建てられない
        if (side > 0 && shore < half + 22 && rng.chance(0.85)) continue;
        if (rng.chance(sec.gap)) continue;
        if (blocked(s, side)) continue;
        if (overWater(s)) continue;

        route.sample(s + rng.range(-1.2, 1.2), 0, sample);

        if (sec.kind === 'kaido') {
          // 松と茶屋を同じ場所に立てない
          if (rng.chance(0.3)) {
            addBuilding(parts, sample, side, half, rng, {
              storeys: 1, width: [4.5, 7], depth: [5, 7], setback: [3.5, 6], shop: true,
              // 在方の茶屋を瓦で葺くことはまず無い
              thatch: 0.82,
            });
          } else {
            parts.pines.push(makePine(sample, side, half, rng));
          }
          continue;
        }

        const spec =
          sec.kind === 'yashiki'
            ? { storeys: 1, width: [9, 18], depth: [7, 12], setback: [2.5, 5.5], shop: false, thatch: 0.34 }
            : sec.kind === 'shuku'
              ? { storeys: 2, width: [4, 7], depth: [7, 11], shop: true, thatch: 0.26 }
              : { storeys: sec.storeys, width: [3.4, 6.4], depth: [6, 11], shop: true, thatch: 0.14 };

        // 溝のある側は家を下げる。溝の上に建てるわけにいかない。
        if (side === gutterSide) spec.setback = [1.65, (spec.setback?.[1] ?? 1.4) + 1.65];

        // 土蔵は町家の代わりに建てる。道に面していないと白い壁が見えない。
        if ((sec.kind === 'machiya' || sec.kind === 'shuku') && rng.chance(0.09)) {
          const w = rng.range(5, 7);
          const d = rng.range(5, 7);
          const kh = rng.range(4.5, 6);
          const yaw = Math.atan2(-sample.tangent.z, sample.tangent.x);
          const u = side * (half + rng.range(0.6, 1.4) + d / 2);
          parts.kura.push({
            pos: new THREE.Vector3(
              sample.pos.x + sample.left.x * u,
              sample.pos.y - 0.1,
              sample.pos.z + sample.left.z * u
            ),
            yaw,
            scale: new THREE.Vector3(w, kh, d),
          });
          continue;
        }

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

  addFences(parts, route, rng, gutterSide, blocked);
  addRoadside(parts, route, rng);

  group.add(instanced(bodyGeometry(), materials.building, parts.bodies));
  group.add(instanced(roofPrism(), materials.roof, parts.roofs));
  group.add(instanced(bodyGeometry(), materials.eaves, parts.eaves));
  group.add(instanced(bodyGeometry(), materials.shopfront, parts.fronts));
  group.add(instanced(bodyGeometry(), materials.noren, parts.norens));
  if (parts.pines.length) {
    group.add(instanced(pineTrunkGeometry(), materials.wood, parts.pines.map((p) => p.trunk)));
    group.add(instanced(pineFoliageGeometry(), materials.foliage, parts.pines.map((p) => p.foliage)));
  }

  group.add(instanced(toriiGeometry(), materials.bengara, parts.torii));
  group.add(instanced(shrineGeometry(), materials.wood, parts.shrines));
  group.add(instanced(yaguraGeometry(), materials.wood, parts.yagura));
  group.add(instanced(stallGeometry(), materials.wood, parts.stalls));
  group.add(instanced(bodyGeometry(), materials.thatch, parts.stallRoofs));
  group.add(instanced(kuraGeometry(), materials.plaster, parts.kura));

  for (const mesh of buildGutter(route, materials, gutterSide, rng)) group.add(mesh);
  return group;
}

/**
 * 町の用水。
 *
 * 宿場や町場の道端には水を流す溝が掘ってある。防火の用水であり、
 * 生活の排水路でもあり、道と屋敷地の境でもあった。家々はここに板を
 * 渡して出入りしたので、通りには一間おきに小さな橋が架かる。
 *
 * 溝は町のあるところだけ。松並木の在方には掘らない。
 */
function buildGutter(route, materials, side, rng) {
  const runs = townRuns(route);
  if (!runs.length) return [];

  const STEP = 3;
  const stone = [];
  const water = [];
  const planks = [];
  const sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };

  for (const run of runs) {
    const rows = [];
    for (let s = run.from; s <= run.to; s += STEP) rows.push(s);
    if (rows.length < 2) continue;
    if (rows[rows.length - 1] < run.to) rows.push(run.to);

    // 溝の断面。手前の石縁、溝底、向こうの石縁の六列。
    const trough = [
      { o: 0.05, y: 0.02 },
      { o: 0.22, y: 0.24 },
      { o: 0.38, y: -0.14 },
      { o: 1.08, y: -0.14 },
      { o: 1.24, y: 0.24 },
      { o: 1.42, y: 0.02 },
    ];
    stone.push(ribbon(route, sample, rows, side, trough));
    water.push(ribbon(route, sample, rows, side, [{ o: 0.4, y: -0.09 }, { o: 1.06, y: -0.09 }]));

    // 板橋。家の出入口ごとに架かるので、間隔は町家の間口くらい。
    for (let s = run.from + 4; s < run.to - 4; s += rng.range(7, 16)) {
      route.sample(s, 0, sample);
      const half = route.widthAt(s) / 2;
      const u = side * (half + 0.73);
      planks.push({
        pos: new THREE.Vector3(
          sample.pos.x + sample.left.x * u,
          sample.pos.y + 0.26,
          sample.pos.z + sample.left.z * u
        ),
        yaw: Math.atan2(-sample.tangent.z, sample.tangent.x),
        scale: new THREE.Vector3(rng.range(1.3, 2.1), 0.12, 1.55),
      });
    }
  }

  const out = [];
  if (stone.length) out.push(new THREE.Mesh(mergeGeometries(stone), materials.stone));
  if (water.length) out.push(new THREE.Mesh(mergeGeometries(water), materials.mizo));
  if (planks.length) out.push(instanced(plankGeometry(), materials.deck, planks));
  for (const m of out) m.name = 'gutter';
  return out;
}

/** 町家の並ぶ区間をひと続きにまとめる。松並木で切れる。 */
function townRuns(route) {
  const runs = [];
  for (const sec of route.sections) {
    if (sec.kind === 'kaido') continue;
    const from = sec.from;
    const to = Math.min(sec.to, route.length);
    if (to - from < 12) continue;
    const last = runs[runs.length - 1];
    if (last && from - last.to < 1) last.to = to;
    else runs.push({ from, to });
  }
  // 渡しの上には溝を通さない
  return runs.filter((r) => route.crossingDropAt((r.from + r.to) / 2) <= 0.25);
}

/**
 * 街道に沿って断面を掃いた帯を一枚作る。
 * spec は中心からの横ずれ o と路面からの高さ y の列。
 */
function ribbon(route, sample, rows, side, spec) {
  const n = rows.length;
  const cols = spec.length;
  const pos = new Float32Array(n * cols * 3);
  for (let i = 0; i < n; i++) {
    const s = rows[i];
    route.sample(s, 0, sample);
    const half = route.widthAt(s) / 2;
    for (let c = 0; c < cols; c++) {
      const u = side * (half + spec[c].o);
      const o = (i * cols + c) * 3;
      pos[o] = sample.pos.x + sample.left.x * u;
      pos[o + 1] = sample.pos.y + spec[c].y;
      pos[o + 2] = sample.pos.z + sample.left.z * u;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      if (side > 0) idx.push(a, d, b, b, d, e);
      else idx.push(a, b, d, b, e, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** 溝に渡す板。二枚並べて端を揃える。 */
function plankGeometry() {
  return mergeGeometries([
    groundedBox(1, 1, 0.46, 0, -0.5, -0.26),
    groundedBox(1, 1, 0.46, 0, -0.5, 0.26),
  ]);
}

/**
 * 屋敷町の板塀。
 *
 * 武家屋敷や寺の門前は、通りに面して長い塀が続く。町家のように店が
 * 開いていないので、塀が無いと家並みのあいだが野原に見えてしまう。
 * 一枚ずつ立てて継いでゆき、途中に門の切れ目を入れる。
 */
function addFences(parts, route, rng, gutterSide, blocked) {
  const sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };
  const PANEL = 4;

  for (const sec of route.sections) {
    if (sec.kind !== 'yashiki') continue;
    const to = Math.min(sec.to, route.length);
    for (let s = sec.from; s < to; s += PANEL) {
      for (const side of [-1, 1]) {
        if (blocked(s, side)) continue;
        if (route.crossingDropAt(s) > 0.25) continue;
        // 門口。ここだけ塀を抜く。
        if (rng.chance(0.14)) continue;

        route.sample(s + PANEL / 2, 0, sample);
        const half = route.widthAt(s) / 2;
        const u = side * (half + (side === gutterSide ? 1.62 : 0.55));
        const yaw = Math.atan2(-sample.tangent.z, sample.tangent.x);
        const base = new THREE.Vector3(
          sample.pos.x + sample.left.x * u,
          sample.pos.y - 0.1,
          sample.pos.z + sample.left.z * u
        );
        const fh = rng.range(1.75, 2.05);

        parts.bodies.push({
          pos: base,
          yaw,
          // 継ぎ目が開かないよう一枚を少し長く取る
          scale: new THREE.Vector3(PANEL + 0.2, fh, 0.18),
          color: new THREE.Color(pick(WALL_TIMBER, rng)).multiplyScalar(rng.range(0.5, 0.66)),
        });
        // 笠木。塀の上に一本被せる。
        parts.eaves.push({
          pos: base.clone().setY(base.y + fh),
          yaw,
          scale: new THREE.Vector3(PANEL + 0.28, 0.13, 0.34),
        });
      }
    }
  }
}

/**
 * 沿道の作り。
 *
 * 町家が並ぶだけでは左右が単調になる。江戸の往来にあったもののうち、
 * 遠くからでも目に付いて、形で分かるものを撒く。
 *
 *   稲荷の祠 … 「伊勢屋 稲荷に 犬の糞」と言われたほど江戸中にあった
 *   火の見櫓 … 町ごとに立てられた望楼。町並みの上に頭を出す
 *   屋台   … 蕎麦・天ぷら・鮨。町なかの道端に出る
 *   土蔵   … 白漆喰に黒い腰。火事の多い江戸で財を守った
 */
function addRoadside(parts, route, rng) {
  const sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };
  const kindAt = (s) => route.sections.find((sec) => s >= sec.from && s < sec.to)?.kind ?? 'machiya';

  // 町家は道にぴたりと面するので、道端の物は店先より手前へ出さないと埋まる。
  // 路肩ぎりぎり（飛脚の寄れる幅の外）に置けば、当たらずに見える。
  const place = (s, side, out, scale, lift = 0, near = [-0.1, 0.4]) => {
    route.sample(s, 0, sample);
    const half = route.widthAt(s) / 2;
    const u = side * (half + rng.range(near[0], near[1]));
    out.push({
      pos: new THREE.Vector3(
        sample.pos.x + sample.left.x * u,
        sample.pos.y - 0.1 + lift,
        sample.pos.z + sample.left.z * u
      ),
      yaw: Math.atan2(-sample.tangent.z, sample.tangent.x),
      scale,
    });
  };

  const clear = (s) => route.landmarks.some((lm) => Math.abs(lm.s - s) < 24);

  for (let s = 60; s < route.length - 60; s += rng.range(28, 70)) {
    if (clear(s)) continue;
    if (route.crossingDropAt(s) > 0.25) continue;
    const kind = kindAt(s);
    const town = kind === 'machiya' || kind === 'shuku';
    const side = rng.chance(0.5) ? -1 : 1;

    // 稲荷の祠。鳥居と小さな社。どこにでもある。
    if (rng.chance(town ? 0.34 : 0.18)) {
      const k = rng.range(1, 1.35);
      place(s, side, parts.torii, new THREE.Vector3(k, k, k));
      // 祠は鳥居の奥。道からの距離で下げる。
      place(s, side, parts.shrines, new THREE.Vector3(k, k, k), 0, [2.1, 2.6]);
      continue;
    }

    // 屋台。町なかの道端に出る。
    if (town && rng.chance(0.26)) {
      const w = rng.range(1.6, 2.2);
      place(s, side, parts.stalls, new THREE.Vector3(w, 1.5, 1.1), 0, [0, 0.5]);
      place(s, side, parts.stallRoofs, new THREE.Vector3(w * 1.25, 0.14, 1.5), 1.95, [0, 0.5]);
      continue;
    }

    // 火の見櫓。数は少なくてよい。町家の屋根の上に頭を出すのが役目なので、
    // 一列うしろに立てて丈で見せる。
    if (town && rng.chance(0.08)) {
      const h = rng.range(10, 14);
      place(s, side, parts.yagura, new THREE.Vector3(1, h, 1), 0, [7, 11]);
    }
  }
}

/**
 * 名所のために沿道を空けておく範囲。
 * 橋や大木戸の周りは両側を、堀は水のある側だけを空ける。
 * side は 0 が両側、+1/-1 が片側。
 */
function keepClearZones(route) {
  const zones = [];
  for (const lm of route.landmarks) {
    if (lm.moat) {
      const half = lm.moat.lengthM / 2 + 20;
      zones.push({ from: lm.s - half, to: lm.s + half, side: lm.moat.side });
    }
    // 名所そのものの足元は必ず空ける
    zones.push({ from: lm.s - 26, to: lm.s + 26, side: 0 });
    // 坂の石垣のように片側だけ長く空けたいものは clearSide を指定する
    if (lm.clearM) {
      zones.push({ from: lm.s - lm.clearM, to: lm.s + lm.clearM, side: lm.clearSide ?? 0 });
    }
  }
  return zones;
}

/* ------------------------------------------------------------------ 部品 */

/**
 * 一軒建てる。
 *
 * 江戸の町家の見えかたを決めているのは三つ。
 *
 *   低い二階 … 二階は天井の低い中二階で、一階の背丈には届かない。
 *              総二階に組むと街道が谷底になり、見上げる町になってしまう。
 *   深い庇  … 一階の上に一間近く突き出す下屋。通りに一本の濃い影が走り、
 *              その下が店になる。町並みを横に貫くこの線が江戸の通りの骨格。
 *   暗い一階 … 店先は建具を外して開け放つので、庇の影と合わせて黒く沈む。
 *              明るい壁が地面まで下りてくると、板張りの町に見えない。
 *
 * @returns {{reach:number}} 街道中心からこの家の裏側までの距離。裏の列を置くのに使う。
 */
function addBuilding(parts, sample, side, half, rng, spec) {
  const w = rng.range(spec.width[0], spec.width[1]);
  const d = rng.range(spec.depth[0], spec.depth[1]);

  const groundH = rng.range(2.4, 2.85);
  // 中二階。通し柱の二階を建てるのは表通りの大店くらいで、宿場では稀。
  const upperH = spec.storeys === 2 ? groundH * rng.range(0.58, 0.78) : 0;
  const h = groundH + upperH;

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

  // 塗屋造の白壁は四、五軒に一軒。板壁ばかりだと通りが茶一色になり、
  // 多すぎると漆喰の町になる。
  const plaster = rng.chance(0.26);
  const wall = new THREE.Color(pick(plaster ? WALL_PLASTER : WALL_TIMBER, rng));
  // 一階は同じ材の暗いほう。軒の影に沈んだ店先の色。
  const lower = wall.clone().multiplyScalar(rng.range(0.4, 0.54));

  const kaya = rng.chance(spec.thatch ?? 0.2);
  const roof = new THREE.Color(pick(kaya ? ROOF_KAYA : ROOF_KAWARA, rng));

  parts.bodies.push({ pos: base, yaw, scale: new THREE.Vector3(w, groundH, d), color: lower });
  if (upperH > 0) {
    parts.bodies.push({
      pos: base.clone().setY(base.y + groundH),
      yaw,
      scale: new THREE.Vector3(w, upperH, d * 0.99),
      color: wall,
    });
  }

  // 屋根。茅は瓦より勾配を急に葺く。水を早く落とさないと腐るからである。
  const pitch = kaya ? rng.range(0.44, 0.56) : rng.range(0.3, 0.38);
  const over = kaya ? 1.34 : 1.28;
  // 妻入り。棟を街道と直角に振った家をたまに混ぜると、軒の列に切れ目ができる。
  const tsuma = spec.shop && rng.chance(0.12);
  parts.roofs.push({
    pos: base.clone().setY(base.y + h),
    yaw: tsuma ? yaw + Math.PI / 2 : yaw,
    scale: tsuma
      ? new THREE.Vector3(d * over, w * pitch * 0.72, w * (over - 0.05))
      : new THREE.Vector3(w * over, d * pitch, d * (over - 0.05)),
    color: roof,
  });

  // 軒裏。屋根の下端に合わせて暗い板を一枚入れる。屋根と壁のあいだが
  // 抜けて見えるのを塞ぎつつ、軒の出の影になる。
  parts.eaves.push({
    pos: base.clone().setY(base.y + h - 0.14),
    yaw: tsuma ? yaw + Math.PI / 2 : yaw,
    scale: tsuma
      ? new THREE.Vector3(d * over * 0.98, 0.24, w * (over - 0.05) * 0.98)
      : new THREE.Vector3(w * over * 0.98, 0.24, d * (over - 0.05) * 0.98),
  });

  if (spec.shop) {
    // 下屋。一階の上から街道へ差し掛ける。これが通りの影の線になる。
    const out = rng.range(1.15, 1.55);
    parts.eaves.push({
      pos: base.clone().addScaledVector(toRoad, d / 2 + out / 2 - 0.08).setY(base.y + groundH - 0.16),
      yaw,
      scale: new THREE.Vector3(w * 1.04, 0.22, out),
    });

    // 店先。建具を外して開ける一階の間口。腰の高さから庇まで暗く落とす。
    parts.fronts.push({
      pos: base.clone().addScaledVector(toRoad, d / 2 + 0.07).setY(base.y + 0.28),
      yaw,
      scale: new THREE.Vector3(w * 0.94, groundH - 0.5, 0.14),
    });

    // 日除けの大暖簾。庇の先から下ろす晒し木綿。丈は人の背より短く、
    // 潜って店に入れるだけの隙間を残す。
    if (rng.chance(0.3)) {
      const hh = rng.range(0.7, 0.95);
      parts.norens.push({
        pos: base
          .clone()
          .addScaledVector(toRoad, d / 2 + out - 0.22)
          .setY(base.y + groundH - 0.3 - hh / 2),
        yaw,
        scale: new THREE.Vector3(w * rng.range(0.72, 0.9), hh, 0.07),
        color: new THREE.Color(pick(HIYOKE_COLORS, rng)),
      });
    } else if (rng.chance(0.62)) {
      // 短い暖簾は店口の上端に垂らす
      parts.norens.push({
        pos: base.clone().addScaledVector(toRoad, d / 2 + 0.16).setY(base.y + groundH - 0.85),
        yaw,
        scale: new THREE.Vector3(w * rng.range(0.66, 0.88), rng.range(0.5, 0.68), 0.08),
        color: new THREE.Color(pick(NOREN_COLORS, rng)),
      });
    }

    // 立て看板。軒と庇で通りは横の線ばかりになるので、縦を一本立てて崩す。
    // 店の端に寄せて置き、間口の真ん中を塞がない。
    if (rng.chance(0.2)) {
      const kh = rng.range(1.5, 2.0);
      const along = new THREE.Vector3(sample.tangent.x, 0, sample.tangent.z)
        .multiplyScalar((rng.chance(0.5) ? 1 : -1) * (w / 2 - 0.3));
      parts.norens.push({
        pos: base
          .clone()
          .add(along)
          .addScaledVector(toRoad, d / 2 + rng.range(0.35, 0.7))
          .setY(base.y + kh / 2),
        yaw,
        scale: new THREE.Vector3(rng.range(0.42, 0.6), kh, 0.11),
        color: new THREE.Color(pick(KANBAN_COLORS, rng)),
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
 * 松の葉。
 *
 * 円錐を積むと杉か樅になってしまう。街道の黒松は葉が平たい塊になって
 * 横へ張り出し、段と段のあいだが透けて空が見える。だから層は平たい皿に
 * 近づけ、互い違いに芯からずらして、上へゆくほど小さくする。
 * 頂も尖らせない。松の梢は丸い。
 */
export function pineFoliageGeometry() {
  const parts = [];
  for (const l of [
    { y: 0.0, r: 0.62, h: 0.15, x: -0.14, z: 0.09 },
    { y: 0.19, r: 0.54, h: 0.13, x: 0.16, z: -0.11 },
    { y: 0.36, r: 0.46, h: 0.13, x: -0.11, z: -0.13 },
    { y: 0.53, r: 0.36, h: 0.12, x: 0.12, z: 0.12 },
    { y: 0.69, r: 0.25, h: 0.12, x: -0.05, z: 0.03 },
  ]) {
    // 上面をわずかに残した截頭錐にすると、葉の塊が皿に見える
    const c = new THREE.CylinderGeometry(l.r * 0.42, l.r, l.h, 8, 1);
    c.translate(l.x, l.y + l.h / 2, l.z);
    parts.push(c);
  }
  return mergeGeometries(parts);
}

/** 稲荷の鳥居。柱二本に笠木と島木、貫を一本。 */
function toriiGeometry() {
  return mergeGeometries([
    groundedBox(0.16, 2.1, 0.16, -0.75, 0, 0),
    groundedBox(0.16, 2.1, 0.16, 0.75, 0, 0),
    groundedBox(2.1, 0.14, 0.22, 0, 1.94, 0), // 島木
    groundedBox(2.35, 0.13, 0.3, 0, 2.08, 0), // 笠木
    groundedBox(1.75, 0.11, 0.16, 0, 1.5, 0), // 貫
  ]);
}

/** 祠。切妻の小さな社。 */
function shrineGeometry() {
  const roof = roofPrism();
  roof.scale(1.5, 0.5, 1.4);
  roof.translate(0, 1.05, 0);
  return mergeGeometries([
    groundedBox(1.2, 0.25, 1.1, 0, 0, 0), // 台
    groundedBox(0.95, 0.85, 0.85, 0, 0.25, 0), // 身舎
    roof,
  ]);
}

/** 火の見櫓。四本の柱を筋交いで組み、上に望楼と半鐘。 */
function yaguraGeometry() {
  const parts = [];
  for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
    parts.push(groundedBox(0.13, 1, 0.13, x, 0, z));
  }
  for (const y of [0.3, 0.6]) {
    parts.push(groundedBox(1.2, 0.07, 0.1, 0, y, -0.5));
    parts.push(groundedBox(1.2, 0.07, 0.1, 0, y, 0.5));
    parts.push(groundedBox(0.1, 0.07, 1.2, -0.5, y, 0));
    parts.push(groundedBox(0.1, 0.07, 1.2, 0.5, y, 0));
  }
  parts.push(groundedBox(1.7, 0.09, 1.7, 0, 0.9, 0)); // 望楼の床
  parts.push(groundedBox(1.5, 0.12, 0.1, 0, 0.99, -0.75)); // 手すり
  parts.push(groundedBox(1.5, 0.12, 0.1, 0, 0.99, 0.75));
  const roof = roofPrism();
  roof.scale(1.9, 0.22, 1.9);
  roof.translate(0, 1.12, 0);
  parts.push(roof);
  return mergeGeometries(parts);
}

/** 屋台。担いで運ぶ台に、脚と品を載せた棚。 */
function stallGeometry() {
  return mergeGeometries([
    groundedBox(1, 0.12, 1, 0, 0.62, 0), // 天板
    groundedBox(0.9, 0.28, 0.8, 0, 0.3, 0), // 箱
    groundedBox(0.1, 0.62, 0.1, -0.42, 0, -0.36),
    groundedBox(0.1, 0.62, 0.1, 0.42, 0, -0.36),
    groundedBox(0.1, 0.62, 0.1, -0.42, 0, 0.36),
    groundedBox(0.1, 0.62, 0.1, 0.42, 0, 0.36),
    groundedBox(0.07, 0.6, 0.07, -0.45, 0.74, 0), // 屋根を支える柱
    groundedBox(0.07, 0.6, 0.07, 0.45, 0.74, 0),
  ]);
}

/** 土蔵。白漆喰の壁に黒い腰、重い瓦屋根。 */
function kuraGeometry() {
  const roof = roofPrism();
  roof.scale(1.16, 0.28, 1.14);
  roof.translate(0, 1, 0);
  return mergeGeometries([
    groundedBox(1, 1, 1, 0, 0, 0),
    groundedBox(1.04, 0.22, 1.04, 0, 0, 0), // 腰
    roof,
  ]);
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
