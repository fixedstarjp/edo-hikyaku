/**
 * 画面の拡大を抑える。
 *
 * `user-scalable=no` と `maximum-scale=1` は iOS Safari が無視する
 * （拡大を取り上げないための仕様）。そのため指二本でつまむと拡大でき、
 * しかも body と canvas の `touch-action: none` が戻す操作まで塞ぐので、
 * 「拡大したまま戻せない」状態になる。
 *
 * そこで Safari 独自の gesture イベントを潰して、そもそも拡大させない。
 * 二本指は左右の親指で操作盤を使うため touchstart 自体は塞げないので、
 * 拡大の合図だけを止める。
 *
 * それでも拡大されてしまった場合に備えて、viewport の指定を貼り直す
 * 戻し口も用意する。Android では効くが、iOS では効かないこともある。
 */

/** これを超えたら拡大されたとみなす。 */
const ZOOMED = 1.05;

export function lockViewportScale() {
  // Safari のつまみ拡大。ここを止めれば拡大が起きない。
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }

  // 二度叩きの拡大。釦の連打は殺さないよう、釦の上では素通しする。
  let lastTouch = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = performance.now();
      const onControl = e.target instanceof Element && e.target.closest('button, .stage-card');
      if (!onControl && now - lastTouch < 320) e.preventDefault();
      lastTouch = now;
    },
    { passive: false }
  );

  watchForZoom();
}

/**
 * 拡大されたら viewport の指定を貼り直して戻しにかかる。
 * 貼り直しでしか戻せないので、拡大を検出したときだけ、間を空けて試す。
 */
function watchForZoom() {
  const vv = window.visualViewport;
  const meta = document.querySelector('meta[name="viewport"]');
  if (!vv || !meta) return;

  const base = meta.getAttribute('content');
  let lastTry = 0;

  const check = () => {
    if (vv.scale <= ZOOMED) return;
    const now = performance.now();
    if (now - lastTry < 1200) return; // 貼り直しの直後に反応して回り続けないように
    lastTry = now;
    meta.setAttribute('content', `${base}, maximum-scale=1`);
    requestAnimationFrame(() => meta.setAttribute('content', base));
  };

  vv.addEventListener('resize', check);
  vv.addEventListener('scroll', check);
}
