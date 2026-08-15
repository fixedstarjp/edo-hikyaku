import * as THREE from 'three';

/**
 * 街道。
 *
 * 位置は「起点からの里程 s (m)」と「横ずれ u (m)」で表す。u は進行方向に対して左が正。
 * 道幅・区間・大名行列の位置は、もとの手書きデータでは名所の名で書かれており、
 * ビルド時に里程へ解決済みのものがここへ来る。
 */
export class Route {
  constructor(src) {
    this.meta = src.meta;
    this.id = src.meta.id;
    this.road = src.meta.road;
    this.name = src.meta.name;
    this.projection = src.projection;
    this.length = src.totalLength;
    this.stats = src.stats;
    this.landmarks = src.landmarks;
    this.gate = src.gate;
    this.startTimeMinutes = src.startTimeMinutes;
    this.sections = src.sections ?? [];
    this.processions = src.processions ?? [];
    this._width = src.width ?? [[0, 10]];

    const { s, x, y, z, grade } = src.samples;
    this.s = Float64Array.from(s);
    this.x = Float32Array.from(x);
    this.y = Float32Array.from(y);
    this.z = Float32Array.from(z);
    this.grade = Float32Array.from(grade);
    this.count = this.s.length;

    this._buildFrames();
    this._shore = (src.shoreline?.byDistanceM ?? []).map(([d, v]) => [d, v]);
  }

  /** 各サンプル点での進行方向と左方向。中央差分で求めて継ぎ目のがたつきを消す。 */
  _buildFrames() {
    const n = this.count;
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      let dx = this.x[b] - this.x[a];
      let dz = this.z[b] - this.z[a];
      const len = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / len;
      this.tz[i] = dz / len;
    }
  }

  /** 表を線形補間する共通処理。 */
  static _lerpTable(table, key, fallback) {
    if (!table.length) return fallback;
    if (key <= table[0][0]) return table[0][1] ?? fallback;
    for (let i = 1; i < table.length; i++) {
      if (key > table[i][0]) continue;
      const [k0, v0] = table[i - 1];
      const [k1, v1] = table[i];
      const a = v0 ?? fallback;
      const b = v1 ?? fallback;
      return a + (b - a) * ((key - k0) / (k1 - k0));
    }
    return table[table.length - 1][1] ?? fallback;
  }

  /**
   * 里程 s における汀線・堀岸までの距離 (m)。
   * 水が見えない区間は霞の外を返す。
   */
  shoreOffsetAt(s) {
    const NO_WATER = 400;
    if (!this._shore.length) return NO_WATER;
    return Route._lerpTable(this._shore, s, NO_WATER);
  }

  /**
   * 街道の幅 (m)。
   * 江戸の大通りは十間近くあったが、宿場や在方の街道は二〜三間しかない。
   */
  widthAt(s) {
    return Route._lerpTable(this._width, s, 10);
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

  /** 里程 s の区間内の位置 t と添字。 */
  _at(s) {
    const clamped = Math.min(Math.max(s, 0), this.length);
    const i = this._segment(clamped);
    const j = i + 1;
    const span = this.s[j] - this.s[i] || 1;
    return { i, j, t: (clamped - this.s[i]) / span };
  }

  /**
   * 里程 s、横ずれ u の位置と姿勢。
   * out に書き込んで返す (毎フレーム呼ぶのでアロケーションを避ける)。
   */
  sample(s, u = 0, out = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() }) {
    const { i, j, t } = this._at(s);

    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    const tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const tl = Math.hypot(tx, tz) || 1;
    out.tangent.set(tx / tl, 0, tz / tl);
    // 左 = up × tangent (右手系, up=+Y)
    out.left.set(out.tangent.z, 0, -out.tangent.x);

    const cx = this.x[i] + (this.x[j] - this.x[i]) * t;
    const cy = this.y[i] + (this.y[j] - this.y[i]) * t;
    const cz = this.z[i] + (this.z[j] - this.z[i]) * t;
    out.pos.set(cx + out.left.x * u, cy, cz + out.left.z * u);
    out.grade = this.grade[i] + (this.grade[j] - this.grade[i]) * t;
    out.elevation = cy;
    return out;
  }

  elevationAt(s) {
    const { i, j, t } = this._at(s);
    return this.y[i] + (this.y[j] - this.y[i]) * t;
  }

  /** 里程 s の勾配 (‰)。正なら上り。 */
  gradeAt(s) {
    const { i, j, t } = this._at(s);
    return this.grade[i] + (this.grade[j] - this.grade[i]) * t;
  }

  /** 局所平面座標を緯度経度へ戻す。小地図で現在地を出すのに使う。 */
  unproject(x, z) {
    const p = this.projection;
    return [p.lat0 - z / p.kz, p.lon0 + x / p.kx];
  }

  /** 里程 s の緯度経度。 */
  latLonAt(s) {
    const { i, j, t } = this._at(s);
    const x = this.x[i] + (this.x[j] - this.x[i]) * t;
    const z = this.z[i] + (this.z[j] - this.z[i]) * t;
    return this.unproject(x, z);
  }

  /** s より先にある最初のランドマーク。 */
  nextLandmark(s) {
    return this.landmarks.find((lm) => lm.s > s + 5) ?? null;
  }

  landmarkByName(name) {
    return this.landmarks.find((lm) => lm.name === name) ?? null;
  }

  /** 制限時間の対象になる大木戸。 */
  get gateLandmark() {
    return this.gate ? this.landmarkByName(this.gate.landmark) : null;
  }
}

/** 生成済みの街道データを読み込む。 */
export async function loadRoute(id) {
  const mod = await import(`../data/${id}.generated.json`);
  return new Route(mod.default ?? mod);
}
