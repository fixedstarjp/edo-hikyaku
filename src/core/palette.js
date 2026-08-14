/**
 * 浮世絵の色。広重の東海道は藍(ベロ藍)の濃淡が骨格になっている。
 * フォトリアルを狙わず、少数の平坦な色で成立させるための基準色。
 */
export const PALETTE = {
  bero: 0x2a5c9a, // ベロ藍 — 空・海の明部
  ai: 0x1b3a63, // 藍 — 海の暗部・遠景
  kon: 0x14243d, // 紺 — 夜
  kinari: 0xefe4cb, // 生成り — 空の低層・霞
  tsuchi: 0xc7a97a, // 土 — 街道の路面
  tsuchiKage: 0x9c8055, // 土の影
  bengara: 0xa8432c, // 弁柄 — 社寺・鳥居
  matsuba: 0x4a6b4a, // 松葉 — 松並木
  wakakusa: 0x7d8f5a, // 若草 — 草地
  sumi: 0x24211e, // 墨 — 輪郭・瓦
  kabe: 0xe3d9c2, // 漆喰壁
  ki: 0x8a6a45, // 木部
  kawara: 0x5b5f64, // 瓦
  yuhi: 0xe8a45c, // 夕日
  akane: 0xc95f3c, // 茜 — 暮六つの空
  hikyaku: 0x2f4f7a, // 飛脚の法被
  hada: 0xd8b48c, // 肌
};

/**
 * トゥーンの階調。
 * 陰の側を落としきらず、陽の側も飛ばさない。木版の刷り重ねに近い幅にする。
 */
const STOPS = [0.42, 0.62, 0.8, 1.0];

export function toonGradient(THREE) {
  const data = Uint8Array.from(STOPS, (v) => Math.round(v * 255));
  const tex = new THREE.DataTexture(data, STOPS.length, 1, THREE.RedFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}
