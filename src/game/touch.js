/**
 * 触れて遊ぶための操作。
 *
 * 鍵盤が無いので、走るのを既定にする。指を離していても飛脚は走り続け、
 * 親指でやることは「避ける」「緩める」「全力」「跳ぶ」「よそ見」の五つだけにした。
 *
 *   左下の輪   … 横へ引けば避ける。下へ引けば歩みを緩める（行列を行き過ごすとき）
 *   右下の二つ … 全力（押している間）と跳ぶ
 *   画面のどこか … 引けばよそ見。離せば正面へ戻る
 */

/** 輪の中心からこれだけ動かしたら効き始める (px)。 */
const DEAD_ZONE = 14;
/** 下へこれだけ引いたら歩みを緩める (px)。 */
const SLOW_PULL = 34;
/** これだけ動かして初めて「よそ見」とみなす。触れただけでは動かさない。 */
const LOOK_SLOP = 8;

export function isCoarsePointer() {
  return matchMedia('(pointer: coarse)').matches;
}

export class TouchControls {
  /**
   * @param input main.js の入力フラグ。ここから書き換える。
   * @param dragLook よそ見の引き量。マウス右ドラッグと同じ入れ物を使う。
   * @param lookScale 1px あたりの角度 (ラジアン)
   * @param getLook いま実際に向いている角度を返す。次のなぞりの起点にする。
   */
  constructor(input, dragLook, lookScale, getLook) {
    this.input = input;
    this.drag = dragLook;
    this.scale = lookScale;
    this.getLook = getLook;

    this.el = document.getElementById('touch');
    this.el.hidden = false;
    document.body.classList.add('touch');

    this.padId = null;
    this.lookId = null;
    this.lookFrom = null;
    this.lookBase = { yaw: 0, pitch: 0 };

    // 触れていなくても走り続ける
    input.forward = true;

    this._bindPad(document.getElementById('touch-pad'));
    this._bindHold(document.getElementById('touch-sprint'), 'sprint');
    this._bindTap(document.getElementById('touch-jump'));
    this._bindLook(document.getElementById('stage'));
  }

  /** 走り出す前に握ったままの指を忘れる。 */
  reset() {
    this.padId = null;
    this.lookId = null;
    this.input.forward = true;
    this.input.back = false;
    this.input.left = false;
    this.input.right = false;
    this.input.sprint = false;
    this.drag.active = false;
  }

  _bindPad(pad) {
    const knob = document.getElementById('touch-knob');
    let origin = null;

    const update = (e) => {
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      this.input.left = dx < -DEAD_ZONE;
      this.input.right = dx > DEAD_ZONE;
      // 下へ引くと緩める。行列を行き過ごすのに使う。
      const slow = dy > SLOW_PULL;
      this.input.back = slow;
      this.input.forward = !slow;

      const r = 34;
      const k = Math.hypot(dx, dy);
      const s = k > r ? r / k : 1;
      knob.style.transform = `translate(${dx * s}px, ${dy * s}px)`;
      pad.classList.toggle('slow', slow);
    };

    pad.addEventListener('pointerdown', (e) => {
      this.padId = e.pointerId;
      origin = { x: e.clientX, y: e.clientY };
      pad.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.padId) return;
      update(e);
    });
    const release = (e) => {
      if (e.pointerId !== this.padId) return;
      this.padId = null;
      this.input.left = false;
      this.input.right = false;
      this.input.back = false;
      this.input.forward = true;
      knob.style.transform = '';
      pad.classList.remove('slow');
    };
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
  }

  _bindHold(el, key) {
    const on = (e) => {
      this.input[key] = true;
      el.classList.add('on');
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const off = () => {
      this.input[key] = false;
      el.classList.remove('on');
    };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
  }

  _bindTap(el) {
    el.addEventListener('pointerdown', (e) => {
      this.input.jump = true;
      el.classList.add('on');
      e.preventDefault();
    });
    const off = () => el.classList.remove('on');
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
  }

  _bindLook(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      this.lookId = e.pointerId;
      this.lookFrom = { x: e.clientX, y: e.clientY };
      // 前回の引き量ではなく、いま向いている角度から始める。
      // 指を離すと首はばねで正面へ戻るので、そこを起点にしないと跳ぶ。
      const now = this.getLook();
      this.lookBase.yaw = now.yaw;
      this.lookBase.pitch = now.pitch;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // 既に離れている指なら捕まえられない。無視してよい。
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const dx = e.clientX - this.lookFrom.x;
      const dy = e.clientY - this.lookFrom.y;
      if (!this.drag.active && Math.hypot(dx, dy) < LOOK_SLOP) return;
      this.drag.active = true;
      this.drag.yaw = this.lookBase.yaw - dx * this.scale.yaw;
      this.drag.pitch = this.lookBase.pitch - dy * this.scale.pitch;
    });

    const release = (e) => {
      if (e.pointerId !== this.lookId) return;
      this.lookId = null;
      this.drag.active = false;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }
}
