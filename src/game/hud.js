import { STAMINA } from '../core/config.js';

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
      speed: document.getElementById('speed'),
      grade: document.getElementById('grade'),
      elevation: document.getElementById('elevation'),
      toast: document.getElementById('toast'),
      banner: document.getElementById('banner'),
      bannerName: document.getElementById('banner-name'),
      bannerKana: document.getElementById('banner-kana'),
      bannerNote: document.getElementById('banner-note'),
    };

    this._buildMarks();
    this._bannerTimer = null;
    this.gateLandmark = route.gateLandmark;
    this.el.deadlineLabel.textContent = this.gateLandmark
      ? `${this.gateLandmark.name} 閉門まで`
      : '閉門まで';
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

    const pct = (player.stamina / STAMINA.max) * 100;
    el.staminaFill.style.width = `${pct}%`;
    el.staminaFill.classList.toggle('spent', player.exhausted);

    el.speed.textContent = `${(player.speed * 3.6).toFixed(1)} km/h`;
    const grade = route.gradeAt(player.s);
    el.grade.textContent = `${grade >= 0 ? '+' : ''}${grade.toFixed(0)} ‰`;
    el.grade.classList.toggle('climb', grade > 12);
    el.elevation.textContent = `標高 ${route.elevationAt(player.s).toFixed(1)} m`;
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
      // 名所が増えたので、読み切れる長さは確保しつつ次に譲る
    }, 6500);
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
