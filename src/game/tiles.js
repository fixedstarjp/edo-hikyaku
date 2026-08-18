/**
 * 地図タイルの取り寄せ。
 *
 * 以前は街道ごとに一枚の大きな画像へ焼いて同梱していたが、
 * 43km で 9.4MB あった。街道を京都まで延ばすと 100MB を超えて割に合わない。
 * そこで実行時に必要な区画だけ取り、覚えておく方式にした。
 *
 * 地理院タイルは Access-Control-Allow-Origin: * を返すので、
 * crossOrigin を付ければ canvas が汚れない。
 *
 * 出典: 国土地理院 淡色地図タイル
 *       https://maps.gsi.go.jp/development/ichiran.html
 */

const DEG = Math.PI / 180;

/** 覚えておく枚数。1 枚 13KB ほどなので、この程度なら軽い。 */
const KEEP = 260;
/** 溢れたときに古いほうから捨てる枚数。毎回一枚ずつ削るより安い。 */
const EVICT = 60;

/** 緯度経度 -> ズーム z の世界ピクセル座標 (Web メルカトル)。 */
export function toWorldPx(lat, lon, zoom, tileSize) {
  const world = tileSize * 2 ** zoom;
  const latRad = lat * DEG;
  return {
    x: ((lon + 180) / 360) * world,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * world,
  };
}

export class TileSource {
  /**
   * @param tileset 地理院タイルの種別（pale = 淡色地図）
   * @param zoom    15 なら 1px およそ 3.9m
   */
  constructor({ tileset = 'pale', zoom = 15, tileSize = 256 } = {}) {
    this.tileset = tileset;
    this.zoom = zoom;
    this.tileSize = tileSize;
    this.max = 2 ** zoom;
    /** 読み込み済み・読み込み中のタイル。値は Image、失敗したものは null。 */
    this.cache = new Map();
    this.pending = 0;
    /** 一枚届くごとに増える。描き手はこれを見て描き直しの要否を決める。 */
    this.version = 0;
  }

  _key(x, y) {
    return `${x}/${y}`;
  }

  /**
   * タイルを返す。まだ無ければ取り寄せを始めて undefined を返す。
   * 呼び手は「無ければ描かない」だけでよい。
   */
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.max || y >= this.max) return null;
    const key = this._key(x, y);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit || undefined;

    // 取り寄せ中の目印として null ではなく空を入れ、二重に頼まないようにする
    this.cache.set(key, false);
    this.pending++;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.cache.set(key, img);
      this.pending--;
      this.version++;
    };
    img.onerror = () => {
      this.cache.set(key, null); // 無い区画。二度と頼まない
      this.pending--;
    };
    img.src = `https://cyberjapandata.gsi.go.jp/xyz/${this.tileset}/${this.zoom}/${x}/${y}.png`;

    if (this.cache.size > KEEP) this._evict();
    return undefined;
  }

  /** 先に取り寄せておく。戻り値は使わない。 */
  prefetch(x, y) {
    this.get(x, y);
  }

  /** 入れた順に古いほうから捨てる。読み込み中のものは残す。 */
  _evict() {
    let n = 0;
    for (const [key, value] of this.cache) {
      if (n >= EVICT) break;
      if (value === false) continue; // まだ来ていない
      this.cache.delete(key);
      n++;
    }
  }
}
