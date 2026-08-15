import * as THREE from 'three';
import { makeRng } from '../core/rng.js';

/**
 * 遠景。
 *
 * 霞の外に置く山の稜線と富士。浮世絵で遠山を藍一色で刷るのと同じ扱いで、
 * 陰影を付けず平らな色の切り絵にする。カメラに追従させるので、
 * 走っても近づかない＝十分に遠い、という見え方になる。
 *
 * 富士は日本橋からおよそ西南西。江戸の町からは方々で富士が見えた
 * （富士見坂・富士見櫓などの地名がその名残）。
 * ここでは実際の見かけの大きさより少し誇張してある。
 */

/** 稜線を置く距離 (m)。霞の外側。 */
const RING_RADIUS = 1650;
const FUJI_RADIUS = 2100;
/** 日本橋から見た富士の方角 (北から時計回りの度)。 */
const FUJI_BEARING = 250;

export class Distance {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.frustumCulled = false;

    this.ridge = new THREE.MeshBasicMaterial({ color: 0x4a5f7e, fog: false, side: THREE.DoubleSide });
    this.fuji = new THREE.MeshBasicMaterial({ color: 0x3d5476, fog: false, side: THREE.DoubleSide });
    this.snow = new THREE.MeshBasicMaterial({ color: 0xcfd8e4, fog: false, side: THREE.DoubleSide });

    this.group.add(buildRidge(this.ridge));
    this.group.add(...buildFuji(this.fuji, this.snow));
    // 空の内側、霞の外側に置く
    this.group.renderOrder = -2;
    scene.add(this.group);
  }

  /** カメラに追従させる。空と同じ扱い。 */
  follow(focus) {
    this.group.position.set(focus.x, 0, focus.z);
  }

  /**
   * 刻に合わせて遠景の色を決める。
   * @param horizon 地平の色  @param deep 遠くの藍  @param light 昼の強さ 0..1
   */
  tint(horizon, deep, light) {
    this.ridge.color.copy(horizon).lerp(deep, 0.62);
    this.fuji.color.copy(horizon).lerp(deep, 0.72);
    this.snow.color.copy(horizon).lerp(new THREE.Color(0xe8eef6), 0.35 + 0.45 * light);
  }
}

/** ぐるりと囲む稜線。 */
function buildRidge(material) {
  const rng = makeRng(1707);
  const n = 128;
  const pos = new Float32Array((n + 1) * 2 * 3);

  // なだらかに繋がるよう、粗い制御点を補間して高さを作る
  const controls = Array.from({ length: 16 }, () => rng.range(10, 52));
  const heightAt = (t) => {
    const f = t * controls.length;
    const i = Math.floor(f) % controls.length;
    const j = (i + 1) % controls.length;
    const k = f - Math.floor(f);
    const smooth = k * k * (3 - 2 * k);
    return controls[i] + (controls[j] - controls[i]) * smooth;
  };

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * Math.PI * 2;
    const x = Math.cos(a) * RING_RADIUS;
    const z = Math.sin(a) * RING_RADIUS;
    // 細かいぎざぎざを重ねて山らしくする
    const h = heightAt(t) + Math.sin(t * Math.PI * 2 * 23) * 7 + Math.sin(t * Math.PI * 2 * 41) * 3.5;

    const o = i * 6;
    pos[o] = x;
    pos[o + 1] = -60;
    pos[o + 2] = z;
    pos[o + 3] = x;
    pos[o + 4] = h;
    pos[o + 5] = z;
  }

  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return mesh;
}

/** 富士。裾を長く引いた円錐に雪の冠を載せる。 */
function buildFuji(body, snow) {
  const bearing = THREE.MathUtils.degToRad(FUJI_BEARING);
  // x=東, z=南。北から時計回りの方位を局所座標へ直す。
  const dx = Math.sin(bearing) * FUJI_RADIUS;
  const dz = -Math.cos(bearing) * FUJI_RADIUS;

  // 実際の見かけは 2 度ほどだが、それでは稜線に埋もれて見分けが付かない。
  // 広重が富士を大きく刷ったのと同じ理屈で 2〜3 倍に誇張してある。
  const height = 195;
  const base = 480;
  const cone = new THREE.ConeGeometry(base, height, 48, 1, true);
  cone.translate(0, height / 2 - 58, 0);
  const mountain = new THREE.Mesh(cone, body);
  mountain.position.set(dx, 0, dz);
  mountain.frustumCulled = false;

  const capH = height * 0.3;
  const capGeo = new THREE.ConeGeometry(base * 0.3, capH, 48, 1, true);
  capGeo.translate(0, height - 58 - capH / 2, 0);
  const cap = new THREE.Mesh(capGeo, snow);
  cap.position.set(dx, 0, dz);
  cap.frustumCulled = false;

  return [mountain, cap];
}
