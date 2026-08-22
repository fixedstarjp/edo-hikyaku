import { STAMINA, TIME_SCALE } from '../core/config.js';

/** 画面表示。3D の外側、ふつうの DOM で組む。 */
export class Hud {
  constructor(route) {
    this.route = route;
    this.el = {
      hud: document.getElementById('hud'),
      koku: document.getElementById('koku'),
      clock: document.getElementById('clock'),
      nextLandmark: document.getElementById('next-landmark'),
      remaining: document.getElementById('remaining'),
      progressFill: document.getElementById('progress-fill'),
      progressMarks: document.getElementById('progress-marks'),
      deadline: document.getElementById('deadline'),
      deadlineLabel: document.getElementById('deadline-label'),
      deadlineValue: document.getElementById('deadline-value'),
      staminaFill: document.getElementById('stamina-fill'),
      gradeAhead: document.getElementById('grade-ahead'),
      speed: document.getElementById('speed'),
      grade: document.getElementById('grade'),
      elevation: document.getElementById('elevation'),
      toast: document.getElementById('toast'),
      stun: document.getElementById('stun'),
      stunCount: document.getElementById('stun-count'),
      banner: document.getElementById('banner'),
      bannerName: document.getElementById('banner-name'),
      bannerKana: document.getElementById('banner-kana'),
      bannerNote: document.getElementById('banner-note'),
    };

    this._buildMarks();
    this._bannerTimer = null;
    this._profileAt = -1e9;
    this.gateLandmark = route.gateLandmark;

    // 大木戸のある街道は閉門、無い街道は問屋場への継立の刻限。
    // 幅の狭い画面では名前を落とさないと小地図とぶつかる。
    const kind = route.gate?.kind === 'keijitsu' ? '刻限' : '閉門';
    this._narrow = matchMedia('(max-width: 560px)');
    this._setDeadlineLabel = () => {
      this.el.deadlineLabel.textContent =
        this.gateLandmark && !this._narrow.matches
          ? `${this.gateLandmark.name} ${kind}まで`
          : `${kind}まで`;
    };
    this._setDeadlineLabel();
    this._narrow.addEventListener('change', this._setDeadlineLabel);
  }

  destroy() {
    this._narrow.removeEventListener('change', this._setDeadlineLabel);
    clearTimeout(this._bannerTimer);
  }

  show() {
    this.el.hud.hidden = false;
  }

  hide() {
    this.el.hud.hidden = true;
  }

  _buildMarks() {
    this.el.progressMarks.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const lm of this.route.landmarks) {
      const mark = document.createElement('span');
      mark.className = `mark mark-${lm.kind}`;
      mark.style.left = `${(lm.s / this.route.length) * 100}%`;
      mark.title = lm.name;
      frag.appendChild(mark);
    }
    this.el.progressMarks.appendChild(frag);
  }

  update({ player, clock, gateClosed }) {
    const { el } = this;
    const route = this.route;

    el.koku.textContent = clock.label;
    el.clock.textContent = `およそ ${clock.modernLabel}`;

    const next = route.nextLandmark(player.s);
    el.nextLandmark.textContent = next ? `次 — ${next.name}` : '品川宿 目前';
    const remain = Math.max(0, route.length - player.s);
    el.remaining.textContent =
      remain > 950 ? `残り ${(remain / 1000).toFixed(2)} km` : `残り ${Math.round(remain)} m`;
    el.progressFill.style.width = `${(player.s / route.length) * 100}%`;

    const gate = this.gateLandmark;
    if (gate && player.s < gate.s) {
      const toDeadline = (route.gate.closesAtMinutes ?? 0) - clock.minutes;
      el.deadline.hidden = false;
      el.deadlineValue.textContent = toDeadline > 0 ? `${Math.ceil(toDeadline)} 分` : '閉門';
      el.deadline.classList.toggle('urgent', toDeadline < 10);
      el.deadline.classList.toggle('closed', gateClosed);
    } else {
      el.deadline.hidden = true;
    }

    // 足止めの残り。ゲーム内の分ではなく、実際に待つ秒数で見せる。
    const leftMinutes = player.stunUntil - clock.minutes;
    if (leftMinutes > 0) {
      el.stun.hidden = false;
      el.stunCount.textContent = Math.ceil((leftMinutes * 60) / TIME_SCALE);
    } else {
      el.stun.hidden = true;
    }

    const pct = (player.stamina / STAMINA.max) * 100;
    el.staminaFill.style.width = `${pct}%`;
    el.staminaFill.classList.toggle('spent', player.exhausted);

    el.speed.textContent = `${(player.speed * 3.6).toFixed(1)} km/h`;
    const grade = route.gradeAt(player.s);
    el.grade.textContent = `${grade >= 0 ? '+' : ''}${grade.toFixed(0)} ‰`;
    el.grade.classList.toggle('climb', grade > 12);
    el.elevation.textContent = `標高 ${route.elevationAt(player.s).toFixed(1)} m`;

    // 縦断は毎コマ描き直す必要が無い。数メートル進んだら描く。
    if (Math.abs(player.s - this._profileAt) > 5) {
      this._profileAt = player.s;
      this._drawProfile(player.s);
    }
  }

  /**
   * 先の道の縦断。
   *
   * 息の配分を決めるには、坂がどこから始まって何メートル続くのかが要る。
   * 足元の勾配を数字で出すだけでは、坂に入ってから気づくことになり、
   * 判断ではなく反応になってしまう。手前 80m から先 620m までを描く。
   *
   * 上りは息を食うので暖色、下りは息が整うので寒色に塗り分ける。
   */
  _drawProfile(s) {
    const cv = this.el.gradeAhead;
    if (!cv) return;
    const g = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const BACK = 80;
    const AHEAD = 620;
    const span = BACK + AHEAD;
    const N = 60;
    const route = this.route;

    const ys = [];
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i <= N; i++) {
      const at = Math.min(route.length, Math.max(0, s - BACK + (span * i) / N));
      const y = route.elevationAt(at);
      ys.push(y);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    // 平らな道で線が暴れないよう、縦の幅に下限を置く
    const mid = (lo + hi) / 2;
    const half = Math.max(7, ((hi - lo) / 2) * 1.3);
    const px = (i) => (W * i) / N;
    const py = (y) => H - 8 - ((y - (mid - half)) / (half * 2)) * (H - 18);

    g.clearRect(0, 0, W, H);

    // 面を塗る
    g.beginPath();
    g.moveTo(0, H);
    for (let i = 0; i <= N; i++) g.lineTo(px(i), py(ys[i]));
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = 'rgba(199, 169, 122, 0.22)';
    g.fill();

    // 稜線。区間ごとに勾配で色を変える。
    g.lineWidth = 3;
    g.lineCap = 'round';
    for (let i = 0; i < N; i++) {
      const rise = ys[i + 1] - ys[i];
      const run = span / N;
      const per = (rise / run) * 1000; // 千分率
      g.strokeStyle =
        per > 14 ? '#d98a4e' : per > 5 ? '#c7a97a' : per < -14 ? '#6fa9c4' : '#9fb08a';
      g.beginPath();
      g.moveTo(px(i), py(ys[i]));
      g.lineTo(px(i + 1), py(ys[i + 1]));
      g.stroke();
    }

    // いまいる場所
    const nowX = (W * BACK) / span;
    g.strokeStyle = 'rgba(239, 228, 203, 0.85)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(nowX, 2);
    g.lineTo(nowX, H - 2);
    g.stroke();
  }

  /** 名所に差しかかったときの札。 */
  banner(landmark) {
    const { el } = this;
    el.bannerName.textContent = landmark.name;
    el.bannerKana.textContent = landmark.kana ?? '';
    el.bannerNote.textContent = landmark.note;
    el.banner.hidden = false;
    el.banner.classList.remove('out');
    // 再アニメーションのためリフローを挟む
    void el.banner.offsetWidth;
    el.banner.classList.add('in');

    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => {
      el.banner.classList.remove('in');
      el.banner.classList.add('out');
      setTimeout(() => {
        el.banner.hidden = true;
      }, 600);
      // 説明が長いものもあるので、読み切れるだけ出しておく
    }, 10000);
  }

  toast(text, { strong = false } = {}) {
    const node = document.createElement('div');
    node.className = `toast${strong ? ' strong' : ''}`;
    node.textContent = text;
    this.el.toast.appendChild(node);
    setTimeout(() => {
      node.classList.add('fade');
      setTimeout(() => node.remove(), 500);
    }, strong ? 2600 : 1500);
  }
}
