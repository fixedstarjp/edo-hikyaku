import * as THREE from 'three';
import { CAMERA, LOOK, SPEED, VIEWS } from '../core/config.js';

/**
 * 飛脚の背中を追うカメラと、よそ見。
 *
 * よそ見は「目標の角」と「いまの角」を分けて持ち、間をばねで繋いである。
 * 首を振り出すときも前へ向き直るときも両端で速度が 0 になるので、
 * 画がぱたりと切り替わらない。
 */

const UP = new THREE.Vector3(0, 1, 0);

/** 臨界減衰のばね。戻り値は [次の値, 次の速度]。 */
function spring(value, velocity, target, dt) {
  const k = LOOK.stiffness;
  const c = 2 * Math.sqrt(k); // 臨界減衰
  const v = velocity + (-k * (value - target) - c * velocity) * dt;
  return [value + v * dt, v];
}

export class ChaseCamera {
  constructor(camera, viewIndex = 0) {
    this.camera = camera;
    this.viewIndex = THREE.MathUtils.clamp(viewIndex, 0, VIEWS.length - 1);
    /** よそ見の向き。0 のとき進行方向。実際の向きは目標へばねで追う。 */
    this.look = { yaw: 0, pitch: 0, vYaw: 0, vPitch: 0, targetYaw: 0, targetPitch: 0 };

    this._target = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._aside = new THREE.Vector3();
    this._sm = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };
  }

  /**
   * よそ見の度合い 0..1。
   * 追従の速さ・霞の距離・見る先をこれで連続に混ぜる。
   * 閾値で切り替えると、前を向き直る瞬間に画がぱたりと切り替わってしまう。
   */
  get away() {
    return THREE.MathUtils.smoothstep(Math.abs(this.look.yaw), 0.05, 0.55);
  }

  /** いまの視点。出立をまたいでも保つ。 */
  get view() {
    return VIEWS[this.viewIndex];
  }

  /** 次の視点へ。戻り値は選んだ視点。 */
  cycleView() {
    this.viewIndex = (this.viewIndex + 1) % VIEWS.length;
    return this.view;
  }

  reset() {
    Object.assign(this.look, { yaw: 0, pitch: 0, vYaw: 0, vPitch: 0, targetYaw: 0, targetPitch: 0 });
  }

  /** よそ見の目標を入力から決め、いまの向きをそこへ寄せる。 */
  aim(dtWall, input, dragLook) {
    const look = this.look;
    const dt = Math.min(dtWall, 1 / 30); // 大きな dt でばねが暴れないように
    const max = THREE.MathUtils.degToRad(LOOK.maxYaw);
    const maxP = THREE.MathUtils.degToRad(LOOK.maxPitch);

    if (dragLook.active) {
      look.targetYaw = THREE.MathUtils.clamp(dragLook.yaw, -max, max);
      look.targetPitch = THREE.MathUtils.clamp(dragLook.pitch, -maxP, maxP);
    } else {
      const key = (input.lookLeft ? 1 : 0) - (input.lookRight ? 1 : 0);
      if (key !== 0) {
        look.targetYaw = THREE.MathUtils.clamp(
          look.targetYaw + key * THREE.MathUtils.degToRad(LOOK.keySpeed) * dt, -max, max
        );
      } else {
        // 手を離したら正面へ戻る
        look.targetYaw = 0;
        look.targetPitch = 0;
      }
    }

    [look.yaw, look.vYaw] = spring(look.yaw, look.vYaw, look.targetYaw, dt);
    [look.pitch, look.vPitch] = spring(look.pitch, look.vPitch, look.targetPitch, dt);
  }

  /**
   * 置きたい位置と注視点を決める。
   * @param snap true なら位置を即座に合わせる（出立のときだけ）
   */
  place(stage, snap) {
    const { route, landmarks, player } = stage;
    const camera = this.camera;
    const sm = this._sm;
    const v = this.view;

    route.sample(player.s, player.u * v.uFollow, sm);
    // 目線のときは本人の頭なので、跳べばカメラも上がる
    const jump = v.firstPerson ? player.jumpY : 0;
    const focusY = sm.pos.y + landmarks.liftAt(player.s) + jump + v.lookHeight;

    // 進行方向を yaw だけ回した向き。これがいま見ている方角。
    this._dir.copy(sm.tangent).applyAxisAngle(UP, this.look.yaw);

    this._target.set(sm.pos.x, focusY + (v.height - v.lookHeight), sm.pos.z);
    this._target.addScaledVector(this._dir, -v.distance);

    // 足に合わせた上下。これが無いと、目線に寄せるほど宙を滑って見える。
    if (v.bob && !player.airborne) {
      const amp = THREE.MathUtils.clamp(player.speed / SPEED.run, 0, 1.2);
      this._target.y += Math.abs(Math.sin(player.phase)) * v.bob * amp;
    }
    if (snap) camera.position.copy(this._target);

    // 正面のときは街道の先（カーブの内側が見える）、よそ見のときは首の向いた先。
    // 二つを連続に混ぜて、向き直る瞬間に画が飛ばないようにする。
    const away = this.away;
    const ahead = player.s + CAMERA.lookAhead;
    route.sample(ahead, player.u * 0.35, sm);
    this._lookAt.set(sm.pos.x, sm.pos.y + landmarks.liftAt(ahead) + jump + v.lookHeight, sm.pos.z);

    if (away > 0) {
      route.sample(player.s, player.u * 0.5, sm);
      this._aside
        .set(sm.pos.x, focusY, sm.pos.z)
        .addScaledVector(this._dir, CAMERA.lookAhead);
      this._aside.y += Math.tan(this.look.pitch) * CAMERA.lookAhead;
      this._lookAt.lerp(this._aside, away);
    }
    camera.lookAt(this._lookAt);
  }

  /** 決めた位置へなめらかに寄せ、画角を速さに合わせる。 */
  follow(dtWall, player) {
    const camera = this.camera;
    const away = this.away;

    // よそ見のあいだは追従を速くして、首を振った先がすぐ見えるようにする
    const v = this.view;
    const lag = Math.max(v.lag, v.lag + (11 - v.lag) * away);
    camera.position.lerp(this._target, 1 - Math.exp(-lag * dtWall));

    const targetFov = v.fov + (player.speed > SPEED.run * 1.05 ? 5 : 0) * (1 - away);
    camera.fov += (targetFov - camera.fov) * Math.min(1, dtWall * 4);
    camera.updateProjectionMatrix();
  }
}
