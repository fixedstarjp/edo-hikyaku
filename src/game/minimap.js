import { Vector3 } from 'three';
import { TileSource, toWorldPx } from './tiles.js';

/**
 * 小地図。
 *
 * 走っている場所が現代のどこなのかを見せる。
 * 背景は国土地理院の淡色地図を実行時に取り寄せたもので、その上に
 * 街道の線と名所、現在地を重ねる。北を上に固定する。
 *
 * 出典表示「地理院タイルを加工」を必ず出すこと。
 */

/** 窓の一辺 (CSS px)。zoom15 では 1px ≒ 3.9m なので、およそ 800m 四方が見える。 */
const SIZE = 208;
/** この先の区画も先に取り寄せておく距離 (m)。走って来てから慌てないように。 */
const LOOK_AHEAD_M = 700;

export class Minimap {
  constructor(route) {
    this.route = route;
    this.tiles = new TileSource({ tileset: 'pale', zoom: 15 });
    this._lastS = -1e9;
    this._lastVersion = -1;
    this._sample = { pos: new Vector3(), tangent: new Vector3(), left: new Vector3() };

    this.el = document.getElementById('minimap');
    this.canvas = document.getElementById('minimap-canvas');
    this.label = document.getElementById('minimap-label');
    this.ctx = this.canvas.getContext('2d');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    // 器のほうは画面幅で細くなる。中身は正方のまま器に合わせて縮める。
    this.canvas.style.width = '100%';
    this.canvas.style.height = 'auto';
    this.ctx.scale(dpr, dpr);

    // 街道の線と名所を、世界ピクセル座標に落としておく
    this.path = [];
    for (let i = 0; i < route.count; i++) {
      const [lat, lon] = route.unproject(route.x[i], route.z[i]);
      this.path.push(this._px(lat, lon));
    }
    this.marks = route.landmarks.map((lm) => {
      const [lat, lon] = route.latLonAt(lm.s);
      return { ...this._px(lat, lon), name: lm.name, kind: lm.kind };
    });

    this.label.textContent = route.landmarks[0]?.name ?? '';
    this._prefetchAround(0);
  }

  _px(lat, lon) {
    return toWorldPx(lat, lon, this.tiles.zoom, this.tiles.tileSize);
  }

  show() {
    this.el.hidden = false;
  }

  hide() {
    this.el.hidden = true;
  }

  destroy() {
    this.tiles.cache.clear();
  }

  /** 里程 s のまわりの区画を取り寄せておく。 */
  _prefetchAround(s) {
    const [lat, lon] = this.route.latLonAt(Math.min(s, this.route.length));
    const p = this._px(lat, lon);
    const t = this.tiles.tileSize;
    const x0 = Math.floor((p.x - SIZE / 2) / t);
    const x1 = Math.floor((p.x + SIZE / 2) / t);
    const y0 = Math.floor((p.y - SIZE / 2) / t);
    const y1 = Math.floor((p.y + SIZE / 2) / t);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) this.tiles.prefetch(x, y);
  }

  /** @param player Player */
  update(player) {
    const next = this.route.nextLandmark(player.s);
    this.label.textContent = next ? next.name : this.route.meta.to;

    // 2m 進むごとに描き直せば十分。ただし区画が新しく届いたときは、
    // 立ち止まっていても敷き直す。でないと出立の一瞬が白いままになる。
    const moved = Math.abs(player.s - this._lastS) >= 2;
    if (!moved && this.tiles.version === this._lastVersion) return;
    this._lastS = player.s;
    this._lastVersion = this.tiles.version;

    const [lat, lon] = this.route.latLonAt(player.s);
    const me = this._px(lat, lon);
    const half = SIZE / 2;
    const ox = me.x - half;
    const oy = me.y - half;

    const g = this.ctx;
    g.save();
    g.clearRect(0, 0, SIZE, SIZE);

    this._drawTiles(g, ox, oy);
    this._prefetchAround(player.s + LOOK_AHEAD_M);

    // 少し沈ませて、上に載せる線を読みやすくする
    g.fillStyle = 'rgba(28, 24, 20, 0.28)';
    g.fillRect(0, 0, SIZE, SIZE);

    this._drawRoute(g, ox, oy);
    this._drawMarks(g, ox, oy);
    this._drawPlayer(g, player, half);

    g.restore();
  }

  /** 窓に掛かる区画だけを貼る。届いていないものは飛ばす。 */
  _drawTiles(g, ox, oy) {
    const t = this.tiles.tileSize;
    const x0 = Math.floor(ox / t);
    const x1 = Math.floor((ox + SIZE - 1) / t);
    const y0 = Math.floor(oy / t);
    const y1 = Math.floor((oy + SIZE - 1) / t);

    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        const img = this.tiles.get(tx, ty);
        if (!img) continue;
        // 区画のうち窓に入っている部分だけを切り出す
        const left = Math.max(ox, tx * t);
        const top = Math.max(oy, ty * t);
        const right = Math.min(ox + SIZE, (tx + 1) * t);
        const bottom = Math.min(oy + SIZE, (ty + 1) * t);
        const w = right - left;
        const h = bottom - top;
        if (w <= 0 || h <= 0) continue;
        g.drawImage(img, left - tx * t, top - ty * t, w, h, left - ox, top - oy, w, h);
      }
    }
  }

  _drawRoute(g, ox, oy) {
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
  }

  _drawMarks(g, ox, oy) {
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
  }

  /** 現在地。進行方向を向いた矢。 */
  _drawPlayer(g, player, half) {
    const sm = this.route.sample(player.s, 0, this._sample);
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
  }
}
