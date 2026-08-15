import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { makeRng } from '../core/rng.js';
import { roofPrism } from '../core/geometry.js';

/**
 * 沿道の名所。
 *
 * 何を建てるかは街道データの landmark.kind と、それに添えられた
 * bridge / gateway / moat の設定で決まる。街道ごとにコードを分けない。
 *
 * 橋は路面を持ち上げる。持ち上げ量は liftAt() で飛脚とカメラにも効かせるので、
 * 太鼓橋を渡ると実際に体が浮く。
 */
export class Landmarks {
  constructor(route, materials) {
    this.route = route;
    this.materials = materials;
    this.group = new THREE.Group();
    this.gateDoors = [];

    this.bridges = route.landmarks
      .filter((lm) => lm.bridge)
      .map((lm) => ({ s: lm.s, radius: lm.bridge.radiusM, rise: lm.bridge.riseM }));

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
    for (const lm of this.route.landmarks) {
      if (lm.bridge) this._bridge(lm);
      if (lm.gateway) this._gateway(lm);
      if (lm.moat) this._moat(lm);

      switch (lm.kind) {
        case 'kosatsu':
          this._kosatsu(lm);
          break;
        case 'okido':
          this._okido(lm);
          break;
        case 'slope':
          this._slope(lm);
          break;
        case 'view':
          if (!lm.moat) this._viewpoint(lm);
          break;
        case 'post':
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

  _box(scale, at, material, extraYaw = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    m.scale.copy(scale);
    m.position.copy(at.pos);
    m.rotation.y = at.yaw + extraYaw;
    this.group.add(m);
    return m;
  }

  /**
   * 街道に沿った帯を張る。
   * colsFn(s, roadY) が [{u, y}, ...] を u の昇順で返す。堀や水面に使う。
   */
  _ribbon(s0, s1, colsFn, material, steps = null) {
    const n = steps ?? Math.max(4, Math.ceil((s1 - s0) / 8));
    const probe = colsFn(s0, this.route.elevationAt(s0));
    const cols = probe.length;
    const pos = new Float32Array((n + 1) * cols * 3);

    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const sm = this.route.sample(s, 0);
      const spec = colsFn(s, sm.pos.y);
      for (let c = 0; c < cols; c++) {
        const o = (i * cols + c) * 3;
        pos[o] = sm.pos.x + sm.left.x * spec[c].u;
        pos[o + 1] = spec[c].y;
        pos[o + 2] = sm.pos.z + sm.left.z * spec[c].u;
      }
    }

    const idx = [];
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = i * cols + c;
        idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.material.side = THREE.DoubleSide;
    this.group.add(mesh);
    return mesh;
  }

  /* -------------------------------------------------------------- 橋 */

  _bridge(lm) {
    const { route, materials } = this;
    const { radiusM: radius, grand } = lm.bridge;
    const half = route.widthAt(lm.s) / 2;
    const steps = 22;

    // 太鼓橋の板張り
    const cols = 2;
    const pos = new Float32Array((steps + 1) * cols * 3);
    for (let i = 0; i <= steps; i++) {
      const s = lm.s - radius + (2 * radius * i) / steps;
      const at = this._at(s, 0);
      for (let c = 0; c < cols; c++) {
        const u = c === 0 ? -half - 0.6 : half + 0.6;
        const o = (i * cols + c) * 3;
        pos[o] = at.sm.pos.x + at.sm.left.x * u;
        pos[o + 1] = at.pos.y + 0.16;
        pos[o + 2] = at.sm.pos.z + at.sm.left.z * u;
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
    for (const side of [-1, 1]) {
      for (let i = 0; i <= postCount; i++) {
        const s = lm.s - radius + (2 * radius * i) / postCount;
        const at = this._at(s, side * (half + 0.55));
        this._box(
          new THREE.Vector3(0.26, 1.25, 0.26),
          { ...at, pos: at.pos.clone().setY(at.pos.y + 0.78) },
          materials.deck
        );
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), materials.brass);
        knob.position.copy(at.pos).setY(at.pos.y + 1.5);
        this.group.add(knob);
      }
      for (let i = 0; i < steps; i++) {
        const a = this._at(lm.s - radius + (2 * radius * i) / steps, side * (half + 0.55));
        const b = this._at(lm.s - radius + (2 * radius * (i + 1)) / steps, side * (half + 0.55));
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

  /* ------------------------------------------------------------- 堀 */

  /** 街道に並んで走る堀。江戸城の内堀・外堀に使う。 */
  _moat(lm) {
    const { materials } = this;
    const { side, offsetM, widthM, lengthM, bankM = 2 } = lm.moat;
    const s0 = Math.max(0, lm.s - lengthM / 2);
    const s1 = Math.min(this.route.length, lm.s + lengthM / 2);

    const inner = side * offsetM;
    const outer = side * (offsetM + widthM);
    const lo = Math.min(inner, outer);
    const hi = Math.max(inner, outer);

    // 水面。地面よりわずかに上へ置いて、石垣で縁を隠す。
    this._ribbon(s0, s1, (s, roadY) => [
      { u: lo, y: roadY - 0.05 },
      { u: hi, y: roadY - 0.05 },
    ], materials.canal);

    // 手前の石垣。街道と水面の境を切る。
    const nearU = inner - side * 0.7;
    this._ribbon(s0, s1, (s, roadY) => [
      { u: Math.min(nearU, inner), y: roadY + 0.55 },
      { u: Math.max(nearU, inner), y: roadY - 0.05 },
    ], materials.stone);

    // 対岸の土手。城側は高く盛られている。
    const farU = outer + side * 12;
    this._ribbon(s0, s1, (s, roadY) => {
      const a = { u: outer, y: roadY - 0.05 };
      const b = { u: farU, y: roadY + bankM };
      return side > 0 ? [a, b] : [b, a];
    }, materials.turf);
  }

  /* ------------------------------------------------------------ 門 */

  _gateway(lm) {
    const { materials } = this;
    const { width, height, side } = lm.gateway;
    const setback = 14;
    const at = this._at(lm.s, side * setback);
    const yaw = at.yaw;
    const alongRoad = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    const pillarR = width * 0.045;
    for (const dx of [-width / 2, width / 2]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(pillarR, pillarR * 1.1, height, 10), materials.bengara);
      p.position.copy(at.pos).setY(at.pos.y + height / 2).addScaledVector(alongRoad, dx);
      this.group.add(p);
    }

    const beam = new THREE.Mesh(new THREE.BoxGeometry(width * 1.14, height * 0.09, width * 0.075), materials.bengara);
    beam.position.copy(at.pos).setY(at.pos.y + height * 0.94);
    beam.rotation.y = yaw;
    this.group.add(beam);

    const nuki = new THREE.Mesh(new THREE.BoxGeometry(width * 1.02, height * 0.055, width * 0.055), materials.bengara);
    nuki.position.copy(at.pos).setY(at.pos.y + height * 0.66);
    nuki.rotation.y = yaw;
    this.group.add(nuki);

    const roof = new THREE.Mesh(roofPrism(), materials.roof);
    roof.scale.set(width * 1.35, height * 0.2, width * 0.5);
    roof.position.copy(at.pos).setY(at.pos.y + height * 0.99);
    roof.rotation.y = yaw;
    this.group.add(roof);

    // 参道・門前の石畳
    const path = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.75, setback * 2), materials.stone);
    path.rotation.x = -Math.PI / 2;
    path.rotation.z = -yaw;
    const mid = this._at(lm.s, (side * setback) / 2);
    path.position.copy(mid.pos).setY(mid.pos.y + 0.02);
    this.group.add(path);
  }

  /* ------------------------------------------------------ 高札場 */

  _kosatsu(lm) {
    const { route, materials } = this;
    const half = route.widthAt(lm.s) / 2;
    const at = this._at(lm.s, -(half + 3.2));
    const alongRoad = new THREE.Vector3(Math.cos(at.yaw), 0, -Math.sin(at.yaw));

    this._box(new THREE.Vector3(5.2, 0.9, 2.6), { ...at, pos: at.pos.clone().setY(at.pos.y + 0.45) }, materials.stone);
    this._box(new THREE.Vector3(4.4, 2.4, 0.22), { ...at, pos: at.pos.clone().setY(at.pos.y + 2.1) }, materials.plaster);
    for (const dx of [-2.3, 2.3]) {
      const p = at.pos.clone().addScaledVector(alongRoad, dx).setY(at.pos.y + 1.8);
      this._box(new THREE.Vector3(0.24, 3.6, 0.24), { ...at, pos: p }, materials.wood);
    }
    const roof = new THREE.Mesh(roofPrism(), materials.roof);
    roof.scale.set(5.4, 0.8, 2.0);
    roof.position.copy(at.pos).setY(at.pos.y + 3.5);
    roof.rotation.y = at.yaw;
    this.group.add(roof);
  }

  /* ---------------------------------------------------------- 大木戸 */

  _okido(lm) {
    const { route, materials } = this;
    const half = route.widthAt(lm.s) / 2;

    // 街道の両脇に築かれた石垣。間を通り抜ける。
    for (const side of [-1, 1]) {
      const base = this._at(lm.s, side * (half + 3.6));
      const wall = new THREE.Mesh(new THREE.BoxGeometry(6.5, 3.6, 6.2), materials.stone);
      wall.position.copy(base.pos).setY(base.pos.y + 1.8);
      wall.rotation.y = base.yaw;
      this.group.add(wall);

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
      this.group.add(door);
      this.gateDoors.push(door);
    }
  }

  setGateClosed(closed) {
    for (const d of this.gateDoors) d.visible = closed;
  }

  /* ------------------------------------------------------------ 坂 */

  /**
   * 急坂。坂に沿って石垣を段違いに積む。
   * 九段坂の名は、坂に沿って九層の石垣段があったことに由来するという。
   */
  _slope(lm) {
    const { route, materials } = this;
    const steps = 9;
    const span = 220;
    for (let k = 0; k < steps; k++) {
      const s = lm.s - span / 2 + (span * k) / (steps - 1);
      const half = route.widthAt(s) / 2;
      const at = this._at(s, -(half + 3.2));
      const h = 1.2 + k * 0.35;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(span / steps + 1.5, h, 7), materials.stone);
      wall.position.copy(at.pos).setY(at.pos.y + h / 2 - 0.3);
      wall.rotation.y = at.yaw;
      this.group.add(wall);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(span / steps + 1.7, 0.4, 7.2), materials.turf);
      cap.position.copy(at.pos).setY(at.pos.y + h - 0.3);
      cap.rotation.y = at.yaw;
      this.group.add(cap);
    }
  }

  /* --------------------------------------------------------- 眺望 */

  _viewpoint(lm) {
    const { route, materials } = this;
    const rng = makeRng(880);
    const half = route.widthAt(lm.s) / 2;

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

    // 立場の掛茶屋
    const at = this._at(lm.s + 30, -(half + 5));
    this._box(new THREE.Vector3(6, 2.6, 5), { ...at, pos: at.pos.clone().setY(at.pos.y + 1.3) }, materials.plaster);
    const roof = new THREE.Mesh(roofPrism(), materials.thatch);
    roof.scale.set(7.2, 1.9, 6.2);
    roof.position.copy(at.pos).setY(at.pos.y + 2.6);
    roof.rotation.y = at.yaw;
    this.group.add(roof);
  }

  /* ---------------------------------------------------------- 宿場 */

  _shukuba(lm) {
    const { route, materials } = this;
    const entry = Math.max(0, lm.s - 300);
    const halfEntry = route.widthAt(entry) / 2;

    // 宿の境を示す傍示杭
    for (const side of [-1, 1]) {
      const at = this._at(entry, side * (halfEntry + 1.4));
      this._box(new THREE.Vector3(0.4, 2.6, 0.4), { ...at, pos: at.pos.clone().setY(at.pos.y + 1.3) }, materials.wood);
    }

    // 問屋場 — ここが継立の場、すなわち終点
    const at = this._at(lm.s, -(route.widthAt(lm.s) / 2 + 5.5));
    this._box(new THREE.Vector3(11, 3.4, 8), { ...at, pos: at.pos.clone().setY(at.pos.y + 1.7) }, materials.plaster);
    const roof = new THREE.Mesh(roofPrism(), materials.roof);
    roof.scale.set(12.6, 2.4, 9.4);
    roof.position.copy(at.pos).setY(at.pos.y + 3.4);
    roof.rotation.y = at.yaw;
    this.group.add(roof);

    // 街道をまたぐ到着の目印
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
