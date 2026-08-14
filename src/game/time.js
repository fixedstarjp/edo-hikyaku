/**
 * 江戸の刻(不定時法)。
 *
 * 日の出(明六つ)から日の入り(暮六つ)までを六等分したものが昼の一刻、
 * 日の入りから日の出までを六等分したものが夜の一刻。季節で長さが変わるが、
 * ここでは春秋分に近い日を想定して明六つ=6時、暮六つ=18時に固定している。
 *
 * 刻の名は九つから四つまで降りて、また九つに戻る。
 */

const DAY_NAMES = ['明六つ', '五つ', '四つ', '九つ', '八つ', '七つ'];
const NIGHT_NAMES = ['暮六つ', '五つ', '四つ', '九つ', '八つ', '七つ'];

export const AKE_MUTSU = 6 * 60; // 明六つ 06:00 (分)
export const KURE_MUTSU = 18 * 60; // 暮六つ 18:00 (分)

export class EdoClock {
  /** @param startMinutes 0時からの分。 */
  constructor(startMinutes) {
    this.minutes = startMinutes;
    this.startMinutes = startMinutes;
  }

  reset() {
    this.minutes = this.startMinutes;
  }

  /** @param dtGameSeconds 進める game 内秒数。 */
  advance(dtGameSeconds) {
    this.minutes += dtGameSeconds / 60;
  }

  get isDaytime() {
    return this.minutes >= AKE_MUTSU && this.minutes < KURE_MUTSU;
  }

  /** 暮六つまでの残り分。過ぎていれば負。 */
  get minutesToKureMutsu() {
    return KURE_MUTSU - this.minutes;
  }

  /** 「七つ半過ぎ」のような表示。 */
  get label() {
    const day = this.isDaytime;
    const base = day ? AKE_MUTSU : this.minutes < AKE_MUTSU ? KURE_MUTSU - 24 * 60 : KURE_MUTSU;
    const span = day ? KURE_MUTSU - AKE_MUTSU : 24 * 60 - (KURE_MUTSU - AKE_MUTSU);
    const kokuLen = span / 6;
    const elapsed = this.minutes - base;
    const index = Math.min(5, Math.max(0, Math.floor(elapsed / kokuLen)));
    const within = (elapsed - index * kokuLen) / kokuLen;
    const name = (day ? DAY_NAMES : NIGHT_NAMES)[index];
    if (within < 0.25) return name;
    if (within < 0.5) return `${name}過ぎ`;
    if (within < 0.75) return `${name}半`;
    return `${name}半過ぎ`;
  }

  /** 参考のための現代時刻表記。 */
  get modernLabel() {
    const m = ((this.minutes % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    const mm = Math.floor(m % 60);
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  /**
   * 太陽の高度 (度)。暮六つで 0、正午で最大。
   * 空の色と陽の傾きを刻に連動させるために使う。
   */
  get sunAltitude() {
    const t = (this.minutes - AKE_MUTSU) / (KURE_MUTSU - AKE_MUTSU); // 0..1 が昼
    return Math.sin(t * Math.PI) * 62 - 2;
  }

  /** 昼の強さ 0..1。暮六つの前後 40 分で滑らかに落ちる。 */
  get daylight() {
    const d = this.minutesToKureMutsu;
    if (d > 40) return 1;
    if (d < -40) return 0;
    return 0.5 * (1 + Math.sin((d / 40) * (Math.PI / 2)));
  }
}
