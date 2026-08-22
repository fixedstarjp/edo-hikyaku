import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';
import { SPEED, STAMINA } from '../core/config.js';

/**
 * 飛脚。
 *
 * 位置は街道上の里程 s と横ずれ u で持つ。速度は「ゲーム内秒あたりの m」なので、
 * 表示される km/h はそのまま史実と比べられる値になる。
 */
export class Player {
  constructor(route, landmarks, materials) {
    this.route = route;
    this.landmarks = landmarks;

    this.s = 0;
    this.u = 0;
    this.speed = 0;
    this.strafe = 0; // 横移動の速さ (-1..1)。入力に追従して動く。
    this.stamina = STAMINA.max;
    this.exhausted = false;
    this.stunUntil = 0; // 足止めが解けるゲーム内時刻 (分)
    this.phase = 0;
    this.jumpY = 0;
    this.jumpV = 0;
    this.airborne = false;
    this.lean = 0;

    this.group = new THREE.Group();
    this._buildModel(materials);

    this._sm = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };
  }

  reset() {
    this.s = 0;
    this.u = 0;
    this.speed = 0;
    this.strafe = 0;
    this.stamina = STAMINA.max;
    this.exhausted = false;
    this.stunUntil = 0;
    this.jumpY = 0;
    this.jumpV = 0;
    this.airborne = false;
  }

  /* --------------------------------------------------------- 見た目 */

  _buildModel(materials) {
    const g = this.group;

    const happi = new THREE.MeshToonMaterial({ color: PALETTE.hikyaku, gradientMap: materials.gradient });
    const skin = new THREE.MeshToonMaterial({ color: PALETTE.hada, gradientMap: materials.gradient });
    const band = new THREE.MeshToonMaterial({ color: PALETTE.bengara, gradientMap: materials.gradient });

    // 胴 (法被)
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.66, 0.32), happi);
    this.torso.position.y = 1.12;
    g.add(this.torso);

    // 腰 (下帯)
    const hip = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.26, 0.3), materials.plaster);
    hip.position.y = 0.76;
    g.add(hip);

    // 頭
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), skin);
    this.head.position.y = 1.62;
    this.head.scale.set(1, 1.12, 0.95);
    g.add(this.head);

    // 鉢巻
    const hachimaki = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.045, 6, 14), band);
    hachimaki.position.y = 1.68;
    hachimaki.rotation.x = Math.PI / 2;
    g.add(hachimaki);
    this.hachimaki = hachimaki;

    // 腕 — 肩を支点に振る
    this.arms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.32, 1.4, 0);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.56, 0.15), skin);
      upper.position.y = -0.28;
      pivot.add(upper);
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.44, 0.13), skin);
      fore.position.set(0, -0.72, 0.1);
      pivot.add(fore);
      g.add(pivot);
      this.arms.push(pivot);
    }

    // 脚
    this.legs = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.14, 0.78, 0);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.44, 0.19), skin);
      thigh.position.y = -0.22;
      pivot.add(thigh);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.16), skin);
      shin.position.y = -0.63;
      pivot.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, 0.3), materials.wood);
      foot.position.set(0, -0.86, 0.05);
      pivot.add(foot);
      g.add(pivot);
      this.legs.push(pivot);
    }

    // 御用箱を担いだ棒 — 飛脚の目印
    const carry = new THREE.Group();
    carry.position.set(0.3, 1.46, 0);
    carry.rotation.z = -0.42;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 6), materials.wood);
    pole.rotation.z = Math.PI / 2;
    carry.add(pole);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.26), materials.goyobako);
    box.position.set(-0.6, -0.16, 0);
    carry.add(box);
    const cord = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.03), materials.wood);
    cord.position.set(-0.6, 0.02, 0);
    carry.add(cord);
    g.add(carry);
    this.carry = carry;
    // 三人称のときの担ぎかた。目線では担ぎ直すので控えておく。
    this._carryRest = { pos: carry.position.clone(), rot: carry.rotation.clone() };
    // 頭のなかへ入るもの一式。目線では消す。
    this._body = [this.torso, this.head, hachimaki, hip, ...this.arms, ...this.legs];
  }

  /**
   * 目線の視点。
   *
   * 自分の頭のなかにカメラが入るので、胴も手足も消す。残すのは担ぎ棒だけ。
   * ただし三人称の担ぎかた（棒を肩に横へ渡す）のままだと、棒が視界を
   * 端から端まで横切ってしまう。目線のときは棒を前後に向け直して右肩へ
   * 寄せ、御用箱を背中へ回す。走る者の目に映るのはその形である。
   */
  setFirstPerson(on) {
    for (const part of this._body) part.visible = !on;
    const c = this.carry;
    if (on) {
      c.position.set(-0.5, 1.36, 0.06);
      c.rotation.set(0.2, -Math.PI / 2, -0.22);
    } else {
      c.position.copy(this._carryRest.pos);
      c.rotation.copy(this._carryRest.rot);
    }
    this._fp = on;
  }

  /* --------------------------------------------------------- 動き */

  get maxLateral() {
    return Math.max(1.2, this.route.widthAt(this.s) / 2 - 0.55);
  }

  /** 上りは遅く、下りはわずかに速い。 */
  gradeFactor() {
    const grade = this.route.gradeAt(this.s);
    if (grade > 0) return 1 - Math.min(grade, 90) / 90 * 0.42;
    return 1 + Math.min(-grade, 90) / 90 * 0.14;
  }

  /**
   * @param dt ゲーム内秒
   * @param input { forward, back, left, right, sprint, jump }
   * @param nowMinutes 現在のゲーム内時刻 (分)
   */
  update(dt, input, nowMinutes) {
    const stunned = nowMinutes < this.stunUntil;
    const gf = this.gradeFactor();

    // 目標速度
    let target;
    if (stunned) {
      target = 0;
    } else if (input.back) {
      target = 0;
    } else if (input.forward && !this.exhausted) {
      target = (input.sprint && this.stamina > 1 ? SPEED.sprint : SPEED.run) * gf;
    } else if (input.forward) {
      target = SPEED.walk * gf; // 息が切れている
    } else {
      target = SPEED.walk * gf;
    }

    const rate = target > this.speed ? SPEED.accel : SPEED.brake;
    this.speed += THREE.MathUtils.clamp(target - this.speed, -rate * dt, rate * dt);
    this.speed = Math.max(0, this.speed);

    // 息
    const grade = Math.max(0, this.route.gradeAt(this.s));
    const gradeCost = grade * STAMINA.gradePenalty;
    if (this.speed > SPEED.walk * 1.15) {
      const sprinting = input.sprint && !this.exhausted && this.speed > SPEED.run * 0.98;
      const drain = (sprinting ? STAMINA.sprintDrain : STAMINA.runDrain) + gradeCost;
      this.stamina -= drain * dt;
    } else if (this.speed > 0.2) {
      this.stamina += (STAMINA.walkRecover - gradeCost * 0.4) * dt;
    } else {
      this.stamina += STAMINA.idleRecover * dt;
    }
    this.stamina = THREE.MathUtils.clamp(this.stamina, 0, STAMINA.max);
    if (this.stamina <= 0.01) this.exhausted = true;
    if (this.exhausted && this.stamina >= STAMINA.exhaustedUntil) this.exhausted = false;

    // 前進
    this.s = Math.min(this.route.length, this.s + this.speed * dt);

    // 左右。
    // 触れる操作は倒し具合を input.lateral (-1..1) で渡してくる。鍵盤は ±1。
    // どちらも同じ軸に足し込んでから、速さを追従させる。
    const wanted = stunned
      ? 0
      : THREE.MathUtils.clamp(
          (input.lateral ?? 0) + (input.left ? 1 : 0) - (input.right ? 1 : 0),
          -1,
          1
        );
    this.strafe += (wanted - this.strafe) * Math.min(1, dt * SPEED.strafeResponse);
    this.u += this.strafe * SPEED.strafe * dt;
    this.u = THREE.MathUtils.clamp(this.u, -this.maxLateral, this.maxLateral);
    this.lean += (this.strafe * -0.16 - this.lean) * Math.min(1, dt * 6);

    // 跳ぶ
    if (input.jump && !this.airborne && !stunned) {
      this.airborne = true;
      this.jumpV = 4.2;
    }
    if (this.airborne) {
      this.jumpV -= 12.5 * dt;
      this.jumpY += this.jumpV * dt;
      if (this.jumpY <= 0) {
        this.jumpY = 0;
        this.jumpV = 0;
        this.airborne = false;
      }
    }

    this._pose(dt);
    this._place();
  }

  _pose(dt) {
    const stride = this.speed / 1.9;
    this.phase += dt * (2.4 + stride * 2.6);
    const amp = THREE.MathUtils.clamp(this.speed / SPEED.run, 0.12, 1.25);

    const swing = Math.sin(this.phase) * amp;
    this.legs[0].rotation.x = swing * 1.05;
    this.legs[1].rotation.x = -swing * 1.05;
    this.arms[0].rotation.x = -swing * 0.85;
    this.arms[1].rotation.x = swing * 0.3; // 担ぎ手はあまり振れない

    const bob = this.airborne ? 0 : Math.abs(Math.sin(this.phase)) * 0.055 * amp;
    this.torso.position.y = 1.12 + bob;
    this.head.position.y = 1.62 + bob;
    this.torso.rotation.x = 0.06 + amp * 0.14; // 速いほど前傾
    // 揺れは担ぎかたに合わせる。目線では棒を前後に向けてあるので、
    // 横へ倒す代わりに前後へ煽る。
    if (this._fp) this.carry.rotation.x = 0.12 + Math.sin(this.phase) * 0.05 * amp;
    else this.carry.rotation.z = -0.42 + Math.sin(this.phase) * 0.05 * amp;
  }

  _place() {
    const sm = this.route.sample(this.s, this.u, this._sm);
    const lift = this.landmarks.liftAt(this.s);
    this.group.position.set(sm.pos.x, sm.pos.y + lift + this.jumpY, sm.pos.z);
    this.group.rotation.y = Math.atan2(sm.tangent.x, sm.tangent.z);
    this.group.rotation.z = this.lean;
  }

  /** 足止め。無礼を咎められた、人にぶつかった、など。 */
  stun(nowMinutes, gameMinutes) {
    this.stunUntil = Math.max(this.stunUntil, nowMinutes + gameMinutes);
    this.speed = 0;
  }
}
