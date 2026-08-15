/**
 * 小地図。
 *
 * 走っている場所が現代のどこなのかを見せる。
 * 背景は国土地理院の淡色地図を切り出したもの（tools/build-map.mjs）で、
 * その上に街道の線と名所、現在地を重ねる。北を上に固定する。
 *
 * 出典表示「地理院タイル」を必ず出すこと。
 */

const DEG = Math.PI / 180;
/** 窓の一辺 (CSS px)。zoom15 では 1px ≒ 3.9m なので、およそ 800m 四方が見える。 */
const SIZE = 208;

function toWorldPx(lat, lon, zoom, tileSize) {
  const world = tileSize * 2 ** zoom;
  const latRad = lat * DEG;
  return {
    x: ((lon + 180) / 360) * world,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * world,
  };
}

export class Minimap {
  /**
   * @param route Route
   * @param meta  public/maps/index.json のうちこの街道の分
   */
  constructor(route, meta) {
    this.route = route;
    this.meta = meta;
    this.ready = false;
    this._lastS = -1e9;

    this.el = document.getElementById('minimap');
    this.canvas = document.getElementById('minimap-canvas');
    this.label = document.getElementById('minimap-label');
    this.ctx = this.canvas.getContext('2d');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    this.canvas.style.width = `${SIZE}px`;
    this.canvas.style.height = `${SIZE}px`;
    this.ctx.scale(dpr, dpr);

    // 街道の線を画像のピクセル座標へ落としておく
    this.path = [];
    for (let i = 0; i < route.count; i++) {
      const [lat, lon] = route.unproject(route.x[i], route.z[i]);
      this.path.push(this._toImagePx(lat, lon));
    }
    this.marks = route.landmarks.map((lm) => {
      const [lat, lon] = route.latLonAt(lm.s);
      return { ...this._toImagePx(lat, lon), name: lm.name, kind: lm.kind };
    });

    this.label.textContent = route.landmarks[0]?.name ?? '';
    this.image = new Image();
    this.loaded = new Promise((done) => {
      this.image.onload = () => {
        this.ready = true;
        this._lastS = -1e9;
        done();
      };
      this.image.onerror = () => done();
    });
    this.image.src = `${import.meta.env.BASE_URL}${meta.image}`;
  }

  _toImagePx(lat, lon) {
    const p = toWorldPx(lat, lon, this.meta.zoom, this.meta.tileSize);
    return { x: p.x - this.meta.originPx.x, y: p.y - this.meta.originPx.y };
  }

  show() {
    this.el.hidden = false;
  }

  hide() {
    this.el.hidden = true;
  }

  destroy() {
    this.image.onload = null;
  }

  /** @param player Player */
  update(player) {
    const next = this.route.nextLandmark(player.s);
    this.label.textContent = next ? next.name : this.route.meta.to;

    if (!this.ready) return;
    // 2m 進むごとに描き直せば十分
    if (Math.abs(player.s - this._lastS) < 2) return;
    this._lastS = player.s;

    const [lat, lon] = this.route.latLonAt(player.s);
    const me = this._toImagePx(lat, lon);
    const half = SIZE / 2;
    const ox = me.x - half;
    const oy = me.y - half;

    const g = this.ctx;
    g.save();
    g.clearRect(0, 0, SIZE, SIZE);

    // 背景の地図
    g.drawImage(this.image, ox, oy, SIZE, SIZE, 0, 0, SIZE, SIZE);
    // 少し沈ませて、上に載せる線を読みやすくする
    g.fillStyle = 'rgba(28, 24, 20, 0.28)';
    g.fillRect(0, 0, SIZE, SIZE);

    // 街道
    g.beginPath();
    for (let i = 0; i < this.path.length; i++) {
      const p = this.path[i];
      const x = p.x - ox;
      const y = p.y - oy;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = 'rgba(18, 14, 12, 0.55)';
    g.lineWidth = 5;
    g.lineJoin = 'round';
    g.stroke();
    g.strokeStyle = '#e08a4a';
    g.lineWidth = 2.4;
    g.stroke();

    // 名所
    for (const m of this.marks) {
      const x = m.x - ox;
      const y = m.y - oy;
      if (x < -12 || y < -12 || x > SIZE + 12 || y > SIZE + 12) continue;
      const big = m.kind === 'okido' || m.kind === 'post' || m.kind === 'origin';
      g.beginPath();
      g.arc(x, y, big ? 4.2 : 2.8, 0, Math.PI * 2);
      g.fillStyle = big ? '#d6564a' : '#efe4cb';
      g.fill();
      g.strokeStyle = 'rgba(18, 14, 12, 0.8)';
      g.lineWidth = 1.2;
      g.stroke();
    }

    // 現在地 — 進行方向を向いた矢
    const sm = this.route.sample(player.s, 0);
    // 画像は北が上、局所座標は z が南。tangent(x=東, z=南) を画面の向きへ直す。
    const heading = Math.atan2(sm.tangent.x, -sm.tangent.z);
    g.translate(half, half);
    g.rotate(heading);
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(5.6, 6);
    g.lineTo(0, 3);
    g.lineTo(-5.6, 6);
    g.closePath();
    g.fillStyle = '#f5e7c8';
    g.fill();
    g.strokeStyle = '#1b1512';
    g.lineWidth = 1.4;
    g.stroke();
    g.restore();
  }
}
