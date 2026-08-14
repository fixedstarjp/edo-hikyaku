import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { makeRng } from '../core/rng.js';
import { roofPrism } from '../core/geometry.js';

/**
 * 沿道の名所。
 *
 * 橋は路面を持ち上げる。持ち上げ量は liftAt() で飛脚とカメラにも効かせるので、
 * 太鼓橋を渡ると実際に体が浮く。
 */

/** 橋 — [ランドマーク名, 半径(m), 迫り上がり(m)] */
const BRIDGES = [
  ['日本橋', 17, 1.35],
  ['京橋', 12, 0.85],
  ['芝口橋', 13, 0.9],
  ['金杉橋', 11, 0.8],
];

export class Landmarks {
  constructor(route, materials) {
    this.route = route;
    this.materials = materials;
    this.group = new THREE.Group();
    this.gateDoors = [];

    this.bridges = BRIDGES.map(([name, radius, rise]) => {
      const lm = route.landmarkByName(name);
      return lm ? { s: lm.s, radius, rise } : null;
    }).filter(Boolean);

    this._build();
  }

  /** 里程 s における路面の迫り上がり (m)。 */
  liftAt(s) {
    let lift = 0;
    for (const b of this.bridges) {
      const d = Math.abs(s - b.s);
      if (d >= b.radius) continue;
      lift += b.rise * 0.5 * (1 + Math.cos((d / b.radius) * Math.PI));
    }
    return lift;
  }

  _build() {
    const { route } = this;
    for (const lm of route.landmarks) {
      switch (lm.name) {
        case '日本橋':
          this._bridge(lm, 17, 1.35, { grand: true });
          break;
        case '京橋':
          this._bridge(lm, 12, 0.85, {});
          break;
        case '芝口橋':
          this._bridge(lm, 13, 0.9, {});
          break;
        case '金杉橋':
          this._bridge(lm, 11, 0.8, {});
          break;
        case '増上寺 大門':
          this._gateway(lm, { width: 15, height: 11, side: -1, approach: true });
          break;
        case '泉岳寺':
          this._gateway(lm, { width: 9, height: 7.5, side: -1, approach: true });
          break;
        case '札の辻':
          this._kosatsu(lm);
          break;
        case '高輪大木戸':
          this._okido(lm);
          break;
        case '八ツ山':
          this._viewpoint(lm);
          break;
        case '品川宿':
          this._shukuba(lm);
          break;
        default:
          break;
      }
    }
  }

  /* ------------------------------------------------------------- 部品 */

  _at(s, u, lift = true) {
    const sm = this.route.sample(s, u);
    const y = sm.pos.y + (lift ? this.liftAt(s) : 0);
    return { pos: new THREE.Vector3(sm.pos.x, y, sm.pos.z), yaw: Math.atan2(-sm.tangent.z, sm.tangent.x), sm };
  }

  _box(geoScale, at, material, extraYaw = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    m.scale.copy(geoScale);
    m.position.copy(at.pos);
    m.rotation.y = at.yaw + extraYaw;
    this.group.add(m);
    return m;
  }

  /* -------------------------------------------------------------- 橋 */

  _bridge(lm, radius, rise, { grand }) {
    const { route, materials } = this;
    const half = route.widthAt(lm.s) / 2;
    const steps = 22;

    // 太鼓橋の板張り
    const cols = 2;
    const pos = new Float32Array((steps + 1) * cols * 3);
    for (let i = 0; i <= steps; i++) {
      const s = lm.s - radius + (2 * radius * i) / steps;
      const at = this._at(s, 0);
      const sm = at.sm;
      for (let c = 0; c < cols; c++) {
        const u = c === 0 ? -half - 0.6 : half + 0.6;
        const o = (i * cols + c) * 3;
        pos[o] = sm.pos.x + sm.left.x * u;
        pos[o + 1] = at.pos.y + 0.16;
        pos[o + 2] = sm.pos.z + sm.left.z * u;
      }
    }
    const deck = new THREE.BufferGeometry();
    deck.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const idx = [];
    for (let i = 0; i < steps; i++) {
      const a = i * cols;
      idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
    deck.setIndex(idx);
    deck.computeVertexNormals();
    this.group.add(new THREE.Mesh(deck, materials.deck));

    // 欄干と擬宝珠
    const postCount = grand ? 7 : 5;
    for (let side of [-1, 1]) {
      for (let i = 0; i <= postCount; i++) {
        const s = lm.s - radius + (2 * radius * i) / postCount;
        const at = this._at(s, side * (half + 0.55));
        this._box(new THREE.Vector3(0.26, 1.25, 0.26), { ...at, pos: at.pos.clone().setY(at.pos.y + 0.78) }, materials.deck);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), materials.brass);
        knob.position.copy(at.pos).setY(at.pos.y + 1.5);
        this.group.add(knob);
      }
      // 手すり
      for (let i = 0; i < steps; i++) {
        const s0 = lm.s - radius + (2 * radius * i) / steps;
        const s1 = lm.s - radius + (2 * radius * (i + 1)) / steps;
        const a = this._at(s0, side * (half + 0.55));
        const b = this._at(s1, side * (half + 0.55));
        const mid = a.pos.clone().lerp(b.pos, 0.5).setY((a.pos.y + b.pos.y) / 2 + 1.3);
        const len = a.pos.distanceTo(b.pos) + 0.05;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.16, 0.2), materials.deck);
        rail.position.copy(mid);
        rail.rotation.y = a.yaw;
        rail.rotation.z = Math.atan2(b.pos.y - a.pos.y, len);
        this.group.add(rail);
      }
    }

    this._canal(lm, radius);
  }

  /** 橋の下の堀川。江戸の川はいずれも石垣で護岸されていた。 */
  _canal(lm, radius) {
    const { route, materials } = this;
    const at = this._at(lm.s, 0, false);
    const width = radius * 1.5;
    // 霞に消える程度まで。これ以上伸ばすと町家の裏まで水浸しになる。
    const reach = 95;

    const water = new THREE.Mesh(new THREE.PlaneGeometry(reach * 2, width), materials.canal);
    water.rotation.x = -Math.PI / 2;
    water.rotation.z = -at.yaw;
    water.position.copy(at.pos).setY(at.pos.y - 0.06);
    this.group.add(water);

    // 両岸の石垣
    const half = route.widthAt(lm.s) / 2;
    for (const bank of [-1, 1]) {
      for (const dir of [-1, 1]) {
        const sm = route.sample(lm.s, 0);
        const along = new THREE.Vector3().copy(sm.left).multiplyScalar(dir * (half + 5 + reach / 2));
        const across = new THREE.Vector3().copy(sm.tangent).multiplyScalar((bank * width) / 2);
        const wall = new THREE.Mesh(new THREE.BoxGeometry(reach, 0.9, 1.2), materials.stone);
        wall.position.copy(at.pos).add(along).add(across).setY(at.pos.y + 0.2);
        wall.rotation.y = at.yaw + Math.PI / 2;
        this.group.add(wall);
      }
    }
  }

  /* ------------------------------------------------------------ 門 */

  _gateway(lm, { width, height, side, approach }) {
    const { materials } = this;
    const setback = 14;
    const at = this._at(lm.s, side * setback);
    const yaw = at.yaw;

    const pillarR = width * 0.045;
    for (const dx of [-width / 2, width / 2]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(pillarR, pillarR * 1.1, height, 10), materials.bengara);
      p.position.copy(at.pos).setY(at.pos.y + height / 2);
      p.position.addScaledVector(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), dx);
      this.group.add(p);
    }

    // 貫と冠木
    const beam = new THREE.Mesh(new THREE.BoxGeometry(width * 1.14, height * 0.09, width * 0.075), materials.bengara);
    beam.position.copy(at.pos).setY(at.pos.y + height * 0.94);
    beam.rotation.y = yaw;
    this.group.add(beam);

    const nuki = new THREE.Mesh(new THREE.BoxGeometry(width * 1.02, height * 0.055, width * 0.055), materials.bengara);
    nuki.position.copy(at.pos).setY(at.pos.y + height * 0.66);
    nuki.rotation.y = yaw;
    this.group.add(nuki);

    // 瓦屋根
    const roof = new THREE.Mesh(roofPrism(), materials.roof);
    roof.scale.set(width * 1.35, height * 0.2, width * 0.5);
    roof.position.copy(at.pos).setY(at.pos.y + height * 0.99);
    roof.rotation.y = yaw;
    this.group.add(roof);

    if (approach) {
      // 参道の石畳
      const path = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.75, setback * 2), materials.stone);
      path.rotation.x = -Math.PI / 2;
      path.rotation.z = -yaw;
      const mid = this._at(lm.s, (side * setback) / 2);
      path.position.copy(mid.pos).setY(mid.pos.y + 0.02);
      this.group.add(path);
    }
  }

  /* ------------------------------------------------------ 高札場 */

  _kosatsu(lm) {
    const { route, materials } = this;
    const half = route.widthAt(lm.s) / 2;
    const at = this._at(lm.s, -(half + 3.2));

    // 石積みの土台
    this._box(new THREE.Vector3(5.2, 0.9, 2.6), { ...at, pos: at.pos.clone().setY(at.pos.y + 0.45) }, materials.stone);
    // 高札の板
    this._box(new THREE.Vector3(4.4, 2.4, 0.22), { ...at, pos: at.pos.clone().setY(at.pos.y + 2.1) }, materials.plaster);
    // 柱
    for (const dx of [-2.3, 2.3]) {
      const p = at.pos.clone().addScaledVector(new THREE.Vector3(Math.cos(at.yaw), 0, -Math.sin(at.yaw)), dx);
      this._box(new THREE.Vector3(0.24, 3.6, 0.24), { ...at, pos: p.setY(at.pos.y + 1.8) }, materials.wood);
    }
    // 小屋根
    const roof = new THREE.Mesh(roofPrism(), materials.roof);
    roof.scale.set(5.4, 0.8, 2.0);
    roof.position.copy(at.pos).setY(at.pos.y + 3.5);
    roof.rotation.y = at.yaw;
    this.group.add(roof);
  }

  /* ---------------------------------------------------- 高輪大木戸 */

  _okido(lm) {
    const { route, materials } = this;
    const half = route.widthAt(lm.s) / 2;
    const at = this._at(lm.s, 0);

    // 街道の両脇に築かれた石垣。間を通り抜ける。
    for (const side of [-1, 1]) {
      const base = this._at(lm.s, side * (half + 3.6));
      const wall = new THREE.Mesh(new THREE.BoxGeometry(6.5, 3.6, 6.2), materials.stone);
      wall.position.copy(base.pos).setY(base.pos.y + 1.8);
      wall.rotation.y = base.yaw;
      this.group.add(wall);

      // 石垣の上の土居 (草)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(6.7, 0.5, 6.4), materials.turf);
      cap.position.copy(base.pos).setY(base.pos.y + 3.8);
      cap.rotation.y = base.yaw;
      this.group.add(cap);
    }

    // 門扉。暮六つに閉じる。
    for (const side of [-1, 1]) {
      const hinge = this._at(lm.s, side * half);
      const door = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.BoxGeometry(half, 3.2, 0.3), materials.wood);
      panel.position.set(-side * (half / 2), 1.6, 0);
      door.add(panel);
      for (const by of [0.5, 1.6, 2.7]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(half * 0.98, 0.18, 0.4), materials.iron);
        band.position.set(-side * (half / 2), by, 0);
        door.add(band);
      }
      door.position.copy(hinge.pos);
      door.rotation.y = hinge.yaw;
      door.visible = false;
      door.userData.side = side;
      this.group.add(door);
      this.gateDoors.push(door);
    }
  }

  setGateClosed(closed) {
    for (const d of this.gateDoors) d.visible = closed;
  }

  /* ----------------------------------------------------- 八ツ山 */

  _viewpoint(lm) {
    const { route, materials } = this;
    const rng = makeRng(880);
    const half = route.widthAt(lm.s) / 2;

    // 頂に立つ榎と、海を見下ろす崖
    for (let k = 0; k < 5; k++) {
      const s = lm.s + rng.range(-60, 60);
      const at = this._at(s, -(half + rng.range(3, 9)));
      const h = rng.range(7, 11);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, h, 7), materials.wood);
      trunk.position.copy(at.pos).setY(at.pos.y + h / 2);
      this.group.add(trunk);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(3, 4.6), 1), materials.tree);
      crown.position.copy(at.pos).setY(at.pos.y + h * 0.92);
      crown.scale.y = 0.72;
      this.group.add(crown);
    }

    // 茶屋 — 立場の掛茶屋
    const at = this._at(lm.s + 30, -(half + 5));
    this._box(new THREE.Vector3(6, 2.6, 5), { ...at, pos: at.pos.clone().setY(at.pos.y + 1.3) }, materials.plaster);
    const roof = new THREE.Mesh(roofPrism(), materials.thatch);
    roof.scale.set(7.2, 1.9, 6.2);
    roof.position.copy(at.pos).setY(at.pos.y + 2.6);
    roof.rotation.y = at.yaw;
    this.group.add(roof);
  }

  /* ---------------------------------------------------- 品川宿 */

  _shukuba(lm) {
    const { route, materials } = this;
    const entry = lm.s - 300;
    const half = route.widthAt(entry) / 2;

    // 宿の境を示す傍示杭
    for (const side of [-1, 1]) {
      const at = this._at(entry, side * (half + 1.4));
      this._box(new THREE.Vector3(0.4, 2.6, 0.4), { ...at, pos: at.pos.clone().setY(at.pos.y + 1.3) }, materials.wood);
    }

    // 問屋場 (ここが継立の場、すなわち終点)
    const at = this._at(lm.s, -(route.widthAt(lm.s) / 2 + 5.5));
    this._box(new THREE.Vector3(11, 3.4, 8), { ...at, pos: at.pos.clone().setY(at.pos.y + 1.7) }, materials.plaster);
    const roof = new THREE.Mesh(roofPrism(), materials.roof);
    roof.scale.set(12.6, 2.4, 9.4);
    roof.position.copy(at.pos).setY(at.pos.y + 3.4);
    roof.rotation.y = at.yaw;
    this.group.add(roof);

    // 街道をまたぐ注連縄めいた到着の目印 (宿の入口を示す幕)
    const goal = this._at(lm.s, 0);
    const gw = route.widthAt(lm.s) + 3;
    for (const side of [-1, 1]) {
      const p = this._at(lm.s, (side * gw) / 2);
      this._box(new THREE.Vector3(0.34, 5.4, 0.34), { ...p, pos: p.pos.clone().setY(p.pos.y + 2.7) }, materials.wood);
    }
    const curtain = new THREE.Mesh(new THREE.BoxGeometry(gw, 1.5, 0.14), materials.bengara);
    curtain.position.copy(goal.pos).setY(goal.pos.y + 4.6);
    curtain.rotation.y = goal.yaw;
    this.group.add(curtain);
  }
}

