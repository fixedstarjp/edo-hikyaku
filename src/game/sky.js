import * as THREE from 'three';
import { PALETTE } from '../core/palette.js';

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uGlow;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -1.0, 1.0);

    // 天頂 -> 中空 -> 地平 の三段。刷り重ねのように段を残す。
    vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.30, h));
    col = mix(col, uTop, smoothstep(0.24, 0.85, h));

    // 陽のかかる側の空を焼く
    float toSun = max(0.0, dot(d, normalize(uSunDir)));
    float horizonWeight = 1.0 - smoothstep(0.0, 0.45, abs(h));
    col += uSunColor * pow(toSun, 4.0) * uGlow * (0.35 + 0.65 * horizonWeight);

    gl_FragColor = vec4(col, 1.0);
  }
`;

/** 刻に連動する空と陽。 */
export class Sky {
  constructor(scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color(PALETTE.bero) },
      uMid: { value: new THREE.Color(PALETTE.bero) },
      uHorizon: { value: new THREE.Color(PALETTE.kinari) },
      uSunColor: { value: new THREE.Color(PALETTE.yuhi) },
      uSunDir: { value: new THREE.Vector3(1, 0.2, 0) },
      uGlow: { value: 0.6 },
    };

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(2200, 32, 20),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      })
    );
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.0);
    this.sun.position.set(-160, 120, -60);
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.ambient = new THREE.HemisphereLight(0xffffff, 0x50493c, 1.0);
    scene.add(this.ambient);

    this.fog = new THREE.Fog(PALETTE.kinari, 0, 1);
    scene.fog = this.fog;

    // 色見本。昼と暮れで刷り分ける。
    this._day = {
      top: new THREE.Color(0x2f63a8),
      mid: new THREE.Color(0x74a6d4),
      horizon: new THREE.Color(0xe9dfc4),
      sun: new THREE.Color(0xfff0d0),
      light: new THREE.Color(0xfff4e0),
      ground: new THREE.Color(0x6b6250),
      fog: new THREE.Color(0xdcd3ba),
    };
    this._dusk = {
      top: new THREE.Color(0x1d3563),
      mid: new THREE.Color(0x6b5a86),
      horizon: new THREE.Color(0xe4894f),
      sun: new THREE.Color(PALETTE.akane),
      light: new THREE.Color(0xffb872),
      ground: new THREE.Color(0x3a3040),
      fog: new THREE.Color(0xc98d63),
    };
    this._night = {
      top: new THREE.Color(0x090f1e),
      mid: new THREE.Color(0x121d35),
      horizon: new THREE.Color(0x24304a),
      sun: new THREE.Color(0x33406a),
      light: new THREE.Color(0x5a6d9c),
      ground: new THREE.Color(0x10141f),
      fog: new THREE.Color(0x141b2c),
    };

    this._tmp = new THREE.Color();

    /** 水面の材質。空を映すので、刻に合わせて色を引き回す。 */
    this.water = null;
    /** 遠景。刻に合わせて藍の濃さを変える。 */
    this.distance = null;
  }

  /**
   * @param clock EdoClock
   * @param focus カメラが見ている位置。空と陽をここに追従させる。
   */
  update(clock, focus) {
    const light = clock.daylight; // 1 = 昼, 0 = 夜
    // 昼 -> 暮れ -> 夜 の二段補間。暮れは daylight 0.5 付近。
    const a = light > 0.5 ? this._day : this._night;
    const b = this._dusk;
    const t = light > 0.5 ? 1 - (light - 0.5) * 2 : light * 2;

    const lerp = (key, target) => target.copy(a[key]).lerp(b[key], t);

    lerp('top', this.uniforms.uTop.value);
    lerp('mid', this.uniforms.uMid.value);
    lerp('horizon', this.uniforms.uHorizon.value);
    lerp('sun', this.uniforms.uSunColor.value);
    lerp('fog', this.fog.color);
    lerp('light', this._tmp);
    this.sun.color.copy(this._tmp);
    lerp('ground', this._tmp);
    this.ambient.groundColor.copy(this._tmp);
    this.ambient.color.copy(this.uniforms.uMid.value);

    this.uniforms.uGlow.value = 0.35 + 0.75 * t * Math.max(0.15, light);

    if (this.water) {
      // 海は空の色を映す。暮れどきは茜、昼は縹。
      this.water.color
        .copy(this.uniforms.uMid.value)
        .lerp(this.uniforms.uHorizon.value, 0.35)
        .multiplyScalar(1.5);
    }

    // 陽は西 (この局所座標では -X) に傾く。
    const alt = THREE.MathUtils.degToRad(Math.max(-6, clock.sunAltitude));
    const dir = new THREE.Vector3(-Math.cos(alt), Math.sin(alt), -0.25 * Math.cos(alt)).normalize();
    this.uniforms.uSunDir.value.copy(dir);

    // 暮六つを過ぎても道が見える程度の下限は残す
    this.sun.intensity = 0.3 + 0.78 * light;
    this.ambient.intensity = 0.34 + 0.26 * light;

    if (this.distance) {
      this.distance.tint(this.uniforms.uHorizon.value, this.uniforms.uTop.value, light);
      if (focus) this.distance.follow(focus);
    }

    if (focus) {
      this.mesh.position.copy(focus);
      this.sun.target.position.copy(focus);
      this.sun.position.copy(focus).addScaledVector(dir, 300);
    }
  }
}
