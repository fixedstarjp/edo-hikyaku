import * as THREE from 'three';
import data from '../data/route-01.generated.json';

/**
 * 街道。
 *
 * 位置は「起点からの里程 s (m)」と「街道中心からの横ずれ u (m)」で表す。
 * u は進行方向に対して左が正。この区間は概ね南へ向かうので、u が正なら東 = 海側になる。
 */
export class Route {
  constructor(src = data) {
    this.meta = src.meta;
    this.origin = src.origin;
    this.length = src.totalLength;
    this.stats = src.stats;
    this.landmarks = src.landmarks;

    const { s, x, y, z, grade } = src.samples;
    this.s = Float64Array.from(s);
    this.x = Float32Array.from(x);
    this.y = Float32Array.from(y);
    this.z = Float32Array.from(z);
    this.grade = Float32Array.from(grade);
    this.count = this.s.length;

    this._buildFrames();
    this._buildShoreline(src.shoreline);
  }

  /** 各サンプル点での進行方向と左方向。中央差分で求めて継ぎ目のがたつきを消す。 */
  _buildFrames() {
    const n = this.count;
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.lx = new Float32Array(n);
    this.lz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      let dx = this.x[b] - this.x[a];
      let dz = this.z[b] - this.z[a];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      this.tx[i] = dx;
      this.tz[i] = dz;
      // 左 = up × tangent (右手系, up=+Y)。南へ進むとき +X = 東を指す。
      this.lx[i] = dz;
      this.lz[i] = -dx;
    }
  }

  /**
   * 江戸期の汀線。里程に対する「街道中心から汀線までの距離」を線形補間する。
   * null の区間は海が見えないので、霞の外 (十分遠く) に置く。
   */
  _buildShoreline(shoreline) {
    this.shorelineNote = shoreline?.note ?? null;
    const pts = shoreline?.byDistanceM ?? [];
    this._shore = pts.map(([s, d]) => [s, d]);
  }

  /** 里程 s における汀線までの距離 (m)。海が無い区間は NO_SEA を返す。 */
  shoreOffsetAt(s) {
    const NO_SEA = 400;
    const pts = this._shore;
    if (pts.length === 0) return NO_SEA;
    if (s <= pts[0][0]) return pts[0][1] ?? NO_SEA;
    for (let i = 1; i < pts.length; i++) {
      if (s > pts[i][0]) continue;
      const [s0, d0] = pts[i - 1];
      const [s1, d1] = pts[i];
      const a = d0 ?? NO_SEA;
      const b = d1 ?? NO_SEA;
      const t = (s - s0) / (s1 - s0);
      return a + (b - a) * t;
    }
    return pts[pts.length - 1][1] ?? NO_SEA;
  }

  /**
   * 街道の幅 (m)。
   * 江戸の大通りは十間近くあったが、宿場や在方の街道は二〜三間しかない。
   * 日本橋を出てから品川宿へ向かうにつれて細くなる。
   */
  widthAt(s) {
    const table = [
      [0, 17], // 日本橋・中央通り
      [2500, 15], // 芝口橋
      [4244, 12], // 金杉橋
      [5639, 9], // 高輪大木戸 — ここから江戸の外
      [6600, 7],
      [7379, 6.5], // 八ツ山
      [8200, 6], // 品川宿
    ];
    if (s <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
      if (s > table[i][0]) continue;
      const [s0, w0] = table[i - 1];
      const [s1, w1] = table[i];
      const t = (s - s0) / (s1 - s0);
      return w0 + (w1 - w0) * t;
    }
    return table[table.length - 1][1];
  }

  /** 里程 s を含む区間の添字。 */
  _segment(s) {
    let lo = 0;
    let hi = this.count - 2;
    if (s <= this.s[0]) return 0;
    if (s >= this.s[hi + 1]) return hi;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.s[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * 里程 s、横ずれ u の位置と姿勢。
   * out に書き込んで返す (毎フレーム呼ぶのでアロケーションを避ける)。
   */
  sample(s, u = 0, out = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() }) {
    const clamped = Math.min(Math.max(s, 0), this.length);
    const i = this._segment(clamped);
    const j = i + 1;
    const span = this.s[j] - this.s[i] || 1;
    const t = (clamped - this.s[i]) / span;

    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    const tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const tl = Math.hypot(tx, tz) || 1;
    out.tangent.set(tx / tl, 0, tz / tl);
    out.left.set(out.tangent.z, 0, -out.tangent.x);

    const cx = this.x[i] + (this.x[j] - this.x[i]) * t;
    const cy = this.y[i] + (this.y[j] - this.y[i]) * t;
    const cz = this.z[i] + (this.z[j] - this.z[i]) * t;
    out.pos.set(cx + out.left.x * u, cy, cz + out.left.z * u);
    out.grade = this.grade[i] + (this.grade[j] - this.grade[i]) * t;
    out.elevation = cy;
    return out;
  }

  /** 里程 s の標高 (m)。 */
  elevationAt(s) {
    const clamped = Math.min(Math.max(s, 0), this.length);
    const i = this._segment(clamped);
    const j = i + 1;
    const span = this.s[j] - this.s[i] || 1;
    const t = (clamped - this.s[i]) / span;
    return this.y[i] + (this.y[j] - this.y[i]) * t;
  }

  /** 里程 s の勾配 (‰)。正なら上り。 */
  gradeAt(s) {
    const clamped = Math.min(Math.max(s, 0), this.length);
    const i = this._segment(clamped);
    const j = i + 1;
    const span = this.s[j] - this.s[i] || 1;
    const t = (clamped - this.s[i]) / span;
    return this.grade[i] + (this.grade[j] - this.grade[i]) * t;
  }

  /** s より先にある最初のランドマーク。 */
  nextLandmark(s) {
    return this.landmarks.find((lm) => lm.s > s + 5) ?? null;
  }

  landmarkByName(name) {
    return this.landmarks.find((lm) => lm.name === name) ?? null;
  }
}
