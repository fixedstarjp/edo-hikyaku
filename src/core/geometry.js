import * as THREE from 'three';

/** 切妻屋根の三角柱。底面が y=0、棟が y=1。棟はローカル X 方向に走る。 */
export function roofPrism() {
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
    -0.5, 1, 0, 0.5, 1, 0,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.setIndex([0, 1, 5, 0, 5, 4, 2, 3, 4, 2, 4, 5, 0, 4, 3, 1, 2, 5, 0, 3, 2, 0, 2, 1]);
  g.computeVertexNormals();
  return g;
}

/** 底面中心を原点にした箱。 */
export function groundedBox(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
}

/** 位置・法線・添字だけを持つ形状をひとつにまとめる。 */
export function mergeGeometries(list) {
  let vertCount = 0;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    vertCount += g.attributes.position.count;
  }

  const pos = new Float32Array(vertCount * 3);
  const nor = new Float32Array(vertCount * 3);
  const idx = [];
  let vOff = 0;

  for (const g of list) {
    pos.set(g.attributes.position.array, vOff * 3);
    nor.set(g.attributes.normal.array, vOff * 3);
    const gi = g.getIndex();
    if (gi) {
      for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + vOff);
    } else {
      for (let i = 0; i < g.attributes.position.count; i++) idx.push(i + vOff);
    }
    vOff += g.attributes.position.count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}
