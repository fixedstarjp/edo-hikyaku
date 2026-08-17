import * as THREE from 'three';
import { makeRng } from '../core/rng.js';
import { SPEED, WORLD_SEED } from '../core/config.js';
import { groundedBox, mergeGeometries } from '../core/geometry.js';
import { instanced } from './townscape.js';

/**
 * 街道の通行人と大名行列。
 *
 * 大名行列は江戸の街道の最大の障害だった。行列に行き合ったら道を譲り、
 * 歩みを緩めねばならない。無礼を咎められれば足止めを食う。
 * 御用の継飛脚には優先権があったともいうが、ここでは町飛脚として扱う。
 */

const TOWNSFOLK_COLORS = [0x5b6b7a, 0x7a6a58, 0x4f5b4a, 0x8a7a63, 0x6a5566, 0x3f4a5c, 0x8f6f56];

/* 毎コマ回す処理で使い回す入れ物。 */
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3();
const _sample = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };


export class Crowd {
  constructor(route, materials) {
    this.route = route;
    this.materials = materials;
    this.group = new THREE.Group();

    const rng = makeRng(WORLD_SEED ^ 0x5f5f);
    this.rng = rng;

    this.statics = []; // 立ち話や店先。位置は動かない
    this.movers = []; // 街道を歩いている者。毎コマ動く
    this.processions = [];

    this._spawnTownsfolk(rng);
    this._spawnProcessions(rng);
    this._buildMeshes();

    this.statics.sort((a, b) => a.s - b.s);
    this._staticS = Float64Array.from(this.statics.map((o) => o.s));
  }

  reset() {
    for (const m of this.movers) {
      m.s = m.baseS;
      m.hitAt = undefined;
    }
    this._writeMovers();
    for (const o of this.statics) o.hitAt = undefined;

    for (const p of this.processions) {
      p.center = p.baseCenter;
      p.scolded = false;
      p.warned = false;
      this._writeProcession(p);
    }
    this.procMesh.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------------------------------------ 配置 */

  /** 里程 s の区間の種別。人出の多さを決めるのに使う。 */
  _sectionKind(s) {
    for (const sec of this.route.sections) {
      if (s >= sec.from && s < sec.to) return sec.kind;
    }
    return this.route.sections.at(-1)?.kind ?? 'machiya';
  }

  _spawnTownsfolk(rng) {
    const { route } = this;
    // 町家の並ぶところと宿場は人が多く、武家地と在方の街道は少ない
    const DENSITY = { machiya: [1, 3], shuku: [1, 3], yashiki: [0, 1], kaido: [0, 1] };

    for (let s = 40; s < route.length - 40; s += rng.range(7, 26)) {
      const [lo, hi] = DENSITY[this._sectionKind(s)] ?? [0, 1];
      const count = rng.int(lo, hi);
      const half = route.widthAt(s) / 2;

      for (let k = 0; k < count; k++) {
        // 端に寄っているほど多い。街道の中央は空けて歩くもの。
        const bias = rng() ** 0.55;
        const u = (rng.chance(0.5) ? -1 : 1) * bias * (half - 0.7);
        const scale = rng.range(0.92, 1.08);
        const color = new THREE.Color(TOWNSFOLK_COLORS[rng.int(0, TOWNSFOLK_COLORS.length - 1)]);

        // 三割ほどは街道を歩いている。上りも下りもいる。
        if (rng.chance(0.3)) {
          const dir = rng.chance(0.5) ? 1 : -1;
          this.movers.push({
            baseS: s,
            s: s + rng.range(-3, 3),
            u,
            dir,
            speed: rng.range(0.85, 1.5),
            phase: rng() * Math.PI * 2,
            rs: 1.0,
            ru: 0.62,
            scaleV: new THREE.Vector3(scale, scale, scale),
            color,
          });
        } else {
          this.statics.push({
            kind: 'walker',
            s: s + rng.range(-3, 3),
            u,
            rs: 1.0,
            ru: 0.62,
            yaw: rng() * Math.PI * 2,
            scale,
            color,
          });
        }
      }

      if (rng.chance(0.05)) {
        this.statics.push({
          kind: 'cart',
          s: s + rng.range(-4, 4),
          u: (rng.chance(0.5) ? -1 : 1) * rng.range(half * 0.35, half - 1.2),
          rs: 1.7,
          ru: 1.1,
          yaw: 0,
          scale: 1,
          color: new THREE.Color(0x8a6a45),
        });
      }
    }
  }

  _spawnProcessions(rng) {
    for (const spec of this.route.processions) {
      const half = this.route.widthAt(spec.center) / 2;
      const members = [];
      const rows = Math.ceil(spec.members / 3);
      const rowGap = 3.2;
      for (let r = 0; r < rows; r++) {
        const perRow = Math.min(3, spec.members - r * 3);
        for (let c = 0; c < perRow; c++) {
          const spread = perRow === 1 ? 0 : (c / (perRow - 1) - 0.5) * 2;
          members.push({
            ds: (r - rows / 2) * rowGap,
            // 行列は道の中ほどを進む。端は往来のために空いている。
            du: spread * half * 0.45,
            rs: 1.0,
            ru: 0.66,
            color: new THREE.Color(r % 4 === 0 ? 0x2c3550 : 0x3d4a63),
          });
        }
      }
      this.processions.push({
        baseCenter: spec.center,
        center: spec.center,
        halfLen: (rows / 2) * rowGap + 3,
        warned: false,
        speed: 1.1, // 日本橋へ向かって進む (里程が減る向き)
        scolded: false,
        note: spec.note,
        members,
      });
    }
  }

  /* ---------------------------------------------------------- 見た目 */

  _buildMeshes() {
    const { materials } = this;

    this.personGeo = personGeometry();
    this.spearGeo = spearmanGeometry();
    this.cartGeo = cartGeometry();

    const walkers = this.statics.filter((o) => o.kind === 'walker');
    const carts = this.statics.filter((o) => o.kind === 'cart');

    this.staticMesh = instanced(this.personGeo, materials.cloth, walkers.map((o) => this._itemFor(o)));
    this.group.add(this.staticMesh);

    // 歩いている者。位置は毎コマ書き換えるので、色だけ先に入れておく。
    this.moverMesh = new THREE.InstancedMesh(
      this.personGeo,
      materials.cloth,
      Math.max(1, this.movers.length)
    );
    this.moverMesh.frustumCulled = false;
    this.moverMesh.count = this.movers.length;
    this.movers.forEach((m, i) => {
      m.index = i;
      this.moverMesh.setColorAt(i, m.color);
    });
    if (this.moverMesh.instanceColor) this.moverMesh.instanceColor.needsUpdate = true;
    this.group.add(this.moverMesh);
    this._writeMovers();

    this.cartMesh = instanced(this.cartGeo, materials.wood, carts.map((o) => this._itemFor(o)));
    this.group.add(this.cartMesh);

    // 行列は動くので毎フレーム行列を書き換える
    const total = this.processions.reduce((n, p) => n + p.members.length, 0);
    this.procMesh = new THREE.InstancedMesh(this.spearGeo, materials.cloth, Math.max(1, total));
    this.procMesh.frustumCulled = false;
    this.group.add(this.procMesh);

    let i = 0;
    for (const p of this.processions) {
      for (const m of p.members) {
        m.index = i++;
        this.procMesh.setColorAt(m.index, m.color);
      }
    }
    if (this.procMesh.instanceColor) this.procMesh.instanceColor.needsUpdate = true;
    this.procMesh.count = total;

    // 初期位置を一度だけ書いておく。以後は近づいたときだけ書き直す。
    for (const p of this.processions) this._writeProcession(p);
    this.procMesh.instanceMatrix.needsUpdate = true;
  }

  _itemFor(o) {
    const sm = this.route.sample(o.s, o.u);
    return {
      pos: sm.pos.clone(),
      yaw: Math.atan2(-sm.tangent.z, sm.tangent.x) + (o.kind === 'walker' ? o.yaw : 0),
      scale: new THREE.Vector3(o.scale, o.scale, o.scale),
      color: o.color,
    };
  }

  /* ------------------------------------------------------------ 更新 */

  /**
   * 行列の一人ひとりを今の中心位置に並べ直す。
   * 毎コマ三十人分を回すので、行列も四元数もサンプルの受け皿も使い回す。
   * route.sample は受け皿を渡さないと毎回 Vector3 を三つ作ってしまう。
   */
  _writeProcession(p) {
    for (const mem of p.members) {
      const sm = this.route.sample(p.center + mem.ds, mem.du, _sample);
      _q.setFromAxisAngle(_up, Math.atan2(-sm.tangent.z, sm.tangent.x) + Math.PI);
      _m.compose(sm.pos, _q, _one);
      this.procMesh.setMatrixAt(mem.index, _m);
    }
  }

  /** 歩いている者を今の位置へ置く。near を渡すとその近くだけ書き換える。 */
  _writeMovers(near = null) {
    for (const m of this.movers) {
      if (near !== null && Math.abs(m.s - near) > 400) continue;
      const sm = this.route.sample(m.s, m.u, _sample);
      // 進む向きへ体を向ける。すれ違う者はこちらを向く。
      _q.setFromAxisAngle(_up, Math.atan2(-sm.tangent.z, sm.tangent.x) + (m.dir > 0 ? 0 : Math.PI));
      _v.copy(sm.pos);
      _v.y += Math.abs(Math.sin(m.phase)) * 0.05; // 歩くたびに上下する
      _m.compose(_v, _q, m.scaleV);
      this.moverMesh.setMatrixAt(m.index, _m);
    }
    this.moverMesh.instanceMatrix.needsUpdate = true;
  }

  update(dtGame, player, nowMinutes) {
    const events = [];

    // 街道を歩いている者。端まで行ったら向きを変えて戻る。
    for (const m of this.movers) {
      m.s += m.dir * m.speed * dtGame;
      if (m.s < 20 || m.s > this.route.length - 20) m.dir *= -1;
      m.phase += dtGame * m.speed * 3.2;
    }
    this._writeMovers(player.s);

    // 遠い行列は動かさないし、行列も書き換えない。
    // 位置は最後に書いたままで正しいので、近づいてから書き直せば足りる。
    let moved = false;
    for (const p of this.processions) {
      if (Math.abs(p.center - player.s) > 600) continue;
      p.center -= p.speed * dtGame;
      this._writeProcession(p);
      moved = true;
    }
    if (moved) this.procMesh.instanceMatrix.needsUpdate = true;

    events.push(...this._checkProcession(player, nowMinutes));
    events.push(...this._checkStatics(player, nowMinutes));
    events.push(...this._checkMovers(player, nowMinutes));
    return events;
  }

  /** 歩いている者との衝突。位置が動くので並べ替えは効かず、素直に舐める。 */
  _checkMovers(player, nowMinutes) {
    const events = [];
    for (const m of this.movers) {
      if (Math.abs(m.s - player.s) > m.rs) continue;
      if (Math.abs(m.u - player.u) > m.ru) continue;
      if (m.hitAt !== undefined && nowMinutes - m.hitAt < 1) continue;
      if (player.jumpY > 0.9) continue; // 跳び越えた

      m.hitAt = nowMinutes;
      player.speed = Math.min(player.speed, SPEED.walk);
      player.stamina = Math.max(0, player.stamina - 3);
      events.push({ type: 'bump', text: '人にぶつかった。', quiet: true });
    }
    return events;
  }

  _checkProcession(player, nowMinutes) {
    const events = [];
    for (const p of this.processions) {
      const ahead = p.center - p.halfLen - player.s;
      if (!p.warned && ahead > 0 && ahead < 80) {
        p.warned = true;
        events.push({
          type: 'warn',
          title: '下に居ろ',
          text: `${p.note}。道の端へ寄り、歩みを緩めて行き過ごせ。`,
        });
      }

      const inside = Math.abs(player.s - p.center) < p.halfLen;
      if (!inside) continue;

      const half = this.route.widthAt(player.s) / 2;
      const clearance = half * 0.5 + 0.9;

      if (player.speed > SPEED.walk * 1.45 && !p.scolded) {
        // ゲーム内の分。時間圧縮が三倍なので、実際に待つのは四十秒ほど。
        // これ以上長くすると、ただ立たされるだけの間が退屈になる。
        p.scolded = true;
        player.stun(nowMinutes, 2);
        events.push({
          type: 'rude',
          title: '無礼者',
          text: '大名行列を駆け抜けようとして咎められた。しばし足止め。',
        });
      } else if (Math.abs(player.u) < clearance && player.speed > SPEED.walk * 0.6) {
        // 列に突っ込んだ
        player.speed = Math.min(player.speed, SPEED.walk * 0.5);
        events.push({ type: 'jostle', text: '行列に阻まれた。道の端へ寄れ。', quiet: true });
      }
    }
    return events;
  }

  _checkStatics(player, nowMinutes) {
    const events = [];
    const arr = this.statics;
    const sArr = this._staticS;

    // player.s の近傍だけ見る
    let lo = 0;
    let hi = sArr.length;
    const from = player.s - 4;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sArr[mid] < from) lo = mid + 1;
      else hi = mid;
    }

    for (let i = lo; i < arr.length && arr[i].s < player.s + 4; i++) {
      const o = arr[i];
      if (o.hitAt !== undefined && nowMinutes - o.hitAt < 1) continue;
      if (Math.abs(o.s - player.s) > o.rs) continue;
      if (Math.abs(o.u - player.u) > o.ru) continue;
      if (player.jumpY > 0.9) continue; // 跳び越えた

      o.hitAt = nowMinutes;
      const hard = o.kind === 'cart';
      player.speed = Math.min(player.speed, hard ? SPEED.walk * 0.3 : SPEED.walk);
      player.stamina = Math.max(0, player.stamina - (hard ? 7 : 3));
      events.push({
        type: 'bump',
        text: hard ? '荷車に行き当たった。' : '人にぶつかった。',
        quiet: true,
      });
    }
    return events;
  }
}

/* -------------------------------------------------------------- 形状 */

function personGeometry() {
  return mergeGeometries([
    groundedBox(0.34, 0.72, 0.24, 0, 0, 0), // 脚
    groundedBox(0.44, 0.58, 0.3, 0, 0.72, 0), // 胴
    groundedBox(0.24, 0.24, 0.22, 0, 1.32, 0), // 頭
  ]);
}

function spearmanGeometry() {
  return mergeGeometries([
    groundedBox(0.34, 0.72, 0.24, 0, 0, 0),
    groundedBox(0.46, 0.58, 0.3, 0, 0.72, 0),
    groundedBox(0.26, 0.2, 0.24, 0, 1.32, 0), // 笠
    groundedBox(0.42, 0.06, 0.42, 0, 1.5, 0), // 笠のつば
    groundedBox(0.07, 2.2, 0.07, 0.3, 0.2, 0), // 槍
  ]);
}

function cartGeometry() {
  const wheel = new THREE.CylinderGeometry(0.55, 0.55, 0.14, 10);
  wheel.rotateZ(Math.PI / 2);
  const left = wheel.clone();
  left.translate(-0.72, 0.55, 0);
  const right = wheel.clone();
  right.translate(0.72, 0.55, 0);
  return mergeGeometries([
    groundedBox(1.4, 0.5, 2.1, 0, 0.7, 0), // 荷台
    groundedBox(1.1, 0.6, 1.6, 0, 1.2, 0), // 荷
    groundedBox(0.12, 0.12, 1.6, 0, 0.95, 1.6), // 梶棒
    left,
    right,
  ]);
}
