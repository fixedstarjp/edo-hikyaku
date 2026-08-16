/**
 * 触れて遊ぶための操作。
 *
 * 左下の輪が足まわり。上へ押しているあいだ走り、離せば歩みに落ちる。
 * 横に倒せば避け、下へ引けば止まる。鍵盤の W / A・D / S と同じ割り当て。
 *
 *   左下の輪   … 上へ押して走る。横へ倒して避ける。下へ引いて止まる
 *   右下の三つ … 見回し（左右）、全力、跳ぶ
 *   画面のどこか … 引けばよそ見。離せば正面へ戻る
 */

/** 輪の中心からこれだけ動かしたら効き始める (px)。ここまでは遊び。 */
const DEAD_ZONE = 20;
/** ここまで倒すと横移動が振り切る (px)。 */
const FULL_TILT = 62;
/** 上へこれだけ押したら走る (px)。 */
const RUN_PUSH = 20;
/** 下へこれだけ引いたら止まる (px)。 */
const SLOW_PULL = 40;
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


    this._bindPad(document.getElementById('touch-pad'));
    this._bindHold(document.getElementById('touch-sprint'), 'sprint');
    this._bindTap(document.getElementById('touch-jump'));
    // 見回しは釦でもできるようにする。なぞって覚えるより分かりやすい。
    this._bindHold(document.getElementById('touch-look-left'), 'lookLeft');
    this._bindHold(document.getElementById('touch-look-right'), 'lookRight');
    this._bindLook(document.getElementById('stage'));
  }

  /** 走り出す前に握ったままの指を忘れる。 */
  reset() {
    this.padId = null;
    this.lookId = null;
    this.input.forward = false;
    this.input.back = false;
    this.input.lateral = 0;
    this.input.sprint = false;
    this.input.lookLeft = false;
    this.input.lookRight = false;
    this.drag.active = false;
    for (const id of ['touch-sprint', 'touch-jump', 'touch-look-left', 'touch-look-right']) {
      document.getElementById(id)?.classList.remove('on');
    }
  }

  _bindPad(pad) {
    const knob = document.getElementById('touch-knob');
    let origin = null;

    const update = (e) => {
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;

      // 倒し具合をそのまま横移動の強さにする。
      // 二乗で効かせるので、半分倒しても四分の一の速さにしかならない。
      // 閾値で切り替えると、少し触れただけで全速で横へ飛んでしまう。
      const t = Math.min(1, Math.max(0, Math.abs(dx) - DEAD_ZONE) / (FULL_TILT - DEAD_ZONE));
      this.input.lateral = dx === 0 ? 0 : -Math.sign(dx) * t * t;

      // 縦は足まわり。上へ押しているあいだだけ走り、下へ引けば止まる。
      // 押していないときは歩き（鍵盤で何も押していないときと同じ）。
      const run = dy < -RUN_PUSH;
      const slow = dy > SLOW_PULL;
      this.input.forward = run;
      this.input.back = slow;

      const r = 34;
      const k = Math.hypot(dx, dy);
      const s = k > r ? r / k : 1;
      knob.style.transform = `translate(${dx * s}px, ${dy * s}px)`;
      pad.classList.toggle('run', run);
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
      this.input.lateral = 0;
      this.input.back = false;
      this.input.forward = false;
      knob.style.transform = '';
      pad.classList.remove('run', 'slow');
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
