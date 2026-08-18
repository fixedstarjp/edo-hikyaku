import * as THREE from 'three';
import { PALETTE, toonGradient } from '../core/palette.js';
import { makeRoadTexture, makeSeaTexture } from './terrain.js';

/**
 * 材質の一式。
 *
 * 全部を同じ 4 段の階調（浮世絵の平塗り）に通すので、ここで一括して作る。
 * 街道を切り替えても作り直さない。造形だけが入れ替わる。
 */
export function createMaterials() {
  const gradient = toonGradient(THREE);
  const toon = (color, extra = {}) =>
    new THREE.MeshToonMaterial({ color, gradientMap: gradient, ...extra });

  return {
    gradient,
    ground: toon(0xffffff, { vertexColors: true }),
    road: toon(0xffffff, { map: makeRoadTexture() }),
    sea: toon(0xffffff, { map: makeSeaTexture() }),
    // building / roof / noren / foliage は InstancedMesh で instanceColor に染められる。
    // 単体で置くものにそのまま使うと真っ白になるので、名所用は別に持つ。
    building: toon(0xffffff),
    roof: toon(0xffffff),
    noren: toon(0xffffff),
    foliage: toon(0xffffff),
    kawara: toon(0x474b52, { side: THREE.DoubleSide }),
    tree: toon(PALETTE.matsuba),

    eaves: toon(0x3b2f24),
    shopfront: toon(0x6b5236),
    wood: toon(PALETTE.ki),
    deck: toon(0xa07c4f),
    // 帯状に張るものは裏からも見えるようにしておく
    stone: toon(0x8e8b84, { side: THREE.DoubleSide }),
    // 城の石垣。街道の石より暗く冷たい色にして、白い坂に見えないようにする。
    ishigaki: toon(0x6a675f, { side: THREE.DoubleSide }),
    plaster: toon(PALETTE.kabe, { side: THREE.DoubleSide }),
    turf: toon(0x6d7d55, { side: THREE.DoubleSide }),
    canal: toon(0x35566d, { side: THREE.DoubleSide }),
    bengara: toon(PALETTE.bengara),
    iron: toon(0x3a3a3c),
    brass: toon(0x9a7d3c),
    thatch: toon(0xa08c62),
    cloth: toon(0xffffff),
    goyobako: toon(0x3a2f28),
    sail: toon(0xe6dfcd, { side: THREE.DoubleSide }),
  };
}
