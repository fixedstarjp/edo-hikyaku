import * as THREE from 'three';
import './styles.css';
import { Route } from './core/route.js';
import { PALETTE, toonGradient } from './core/palette.js';
import { CAMERA, FOG, FAST_FORWARD, SPEED, START_TIME_MINUTES, TIME_SCALE } from './core/config.js';
import { buildTerrain, makeRoadTexture, makeSeaTexture } from './game/terrain.js';
import { buildTownscape } from './game/townscape.js';
import { Landmarks } from './game/landmarks.js';
import { Crowd } from './game/obstacles.js';
import { Player } from './game/player.js';
import { Hud } from './game/hud.js';
import { EdoClock, KURE_MUTSU } from './game/time.js';
import { Sky } from './game/sky.js';

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.3, 3000);

/* ------------------------------------------------------------- 材質 */

const gradient = toonGradient(THREE);
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: gradient, ...extra });

const roadTexture = makeRoadTexture();
const seaTexture = makeSeaTexture();

const materials = {
  gradient,
  ground: toon(0xffffff, { vertexColors: true }),
  road: toon(0xffffff, { map: roadTexture }),
  sea: toon(0xffffff, { map: seaTexture }),
  building: toon(0xffffff),
  roof: toon(0xffffff),
  eaves: toon(0x3b2f24),
  shopfront: toon(0x6b5236),
  noren: toon(0xffffff),
  wood: toon(PALETTE.ki),
  // 単体で置く樹木用。instancedMesh の foliage は instanceColor で染めるので白のまま。
  tree: toon(PALETTE.matsuba),
  deck: toon(0xa07c4f),
  foliage: toon(0xffffff),
  stone: toon(0x8e8b84),
  plaster: toon(PALETTE.kabe),
  bengara: toon(PALETTE.bengara),
  iron: toon(0x3a3a3c),
  brass: toon(0x9a7d3c),
  turf: toon(0x6d7d55),
  thatch: toon(0xa08c62),
  canal: toon(0x35566d),
  cloth: toon(0xffffff),
  goyobako: toon(0x3a2f28),
};

/* --------------------------------------------------------- 世界を組む */

const route = new Route();
const landmarks = new Landmarks(route, materials);
const crowd = new Crowd(route, materials);
const player = new Player(route, landmarks, materials);

scene.add(buildTerrain(route, materials));
scene.add(buildTownscape(route, materials));
scene.add(landmarks.group);
scene.add(crowd.group);
scene.add(player.group);

const sky = new Sky(scene);
sky.water = materials.sea;
scene.fog.near = FOG.near;
scene.fog.far = FOG.far;

const clock = new EdoClock(START_TIME_MINUTES);
const hud = new Hud(route);

/* ------------------------------------------------------------- 入力 */

const input = { forward: false, back: false, left: false, right: false, sprint: false, jump: false, fast: false };
const KEYS = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyF: 'fast',
};

addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    input.jump = true;
    e.preventDefault();
    return;
  }
  if (e.code === 'KeyR') {
    if (state.phase !== 'title') restart();
    return;
  }
  const k = KEYS[e.code];
  if (k) {
    input[k] = true;
    e.preventDefault();
  }
});

addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    input.jump = false;
    return;
  }
  const k = KEYS[e.code];
  if (k) input[k] = false;
});

addEventListener('blur', () => {
  for (const k of Object.keys(input)) input[k] = false;
});

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ------------------------------------------------------------- 進行 */

const okido = route.landmarkByName('高輪大木戸');

const state = {
  phase: 'title', // title | running | result
  seenLandmarks: new Set(),
  penalties: 0,
  bumps: 0,
  okidoPassedAt: null,
  finishedAt: null,
};

function resetState() {
  clock.reset();
  player.reset();
  crowd.reset();
  landmarks.setGateClosed(false);
  state.seenLandmarks.clear();
  state.penalties = 0;
  state.bumps = 0;
  state.okidoPassedAt = null;
  state.finishedAt = null;
  placeCamera(true);
}

function start() {
  resetState();
  state.phase = 'running';
  document.getElementById('title-screen').hidden = true;
  document.getElementById('result-screen').hidden = true;
  hud.show();
  hud.banner(route.landmarks[0]);
}

function restart() {
  start();
}

function finish(kind) {
  state.phase = 'result';
  state.finishedAt = clock.minutes;
  hud.hide();
  showResult(kind);
}

/* ------------------------------------------------------------ カメラ */

const camTarget = new THREE.Vector3();
const camLook = new THREE.Vector3();
const sm = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };

function desiredCamera(out) {
  route.sample(player.s, player.u * 0.5, sm);
  const lift = landmarks.liftAt(player.s);
  out.set(sm.pos.x, sm.pos.y + lift + CAMERA.height, sm.pos.z);
  out.addScaledVector(sm.tangent, -CAMERA.distance);
  return out;
}

function placeCamera(snap) {
  desiredCamera(camTarget);
  if (snap) camera.position.copy(camTarget);

  route.sample(player.s + CAMERA.lookAhead, player.u * 0.35, sm);
  camLook.set(sm.pos.x, sm.pos.y + landmarks.liftAt(player.s + CAMERA.lookAhead) + CAMERA.lookHeight, sm.pos.z);
  camera.lookAt(camLook);
}

/* ------------------------------------------------------------ ループ */

let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dtWall = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state.phase === 'running') {
    step(dtWall);
  } else {
    // 題名画面と結果画面でも空だけは動かす
    sky.update(clock, camera.position);
  }

  renderer.render(scene, camera);
}

function step(dtWall) {
  const scale = TIME_SCALE * (input.fast ? FAST_FORWARD : 1);
  const dt = dtWall * scale;

  clock.advance(dt);
  player.update(dt, input, clock.minutes);
  input.jump = false; // 押しっぱなしで連続跳躍させない

  for (const ev of crowd.update(dt, player, clock.minutes)) {
    if (ev.type === 'rude') {
      state.penalties += 1;
      hud.toast(`${ev.title} — ${ev.text}`, { strong: true });
    } else if (ev.type === 'warn') {
      hud.toast(`${ev.title} — ${ev.text}`, { strong: true });
    } else if (ev.type === 'bump') {
      state.bumps += 1;
      hud.toast(ev.text);
    } else {
      hud.toast(ev.text);
    }
  }

  // 名所の札
  for (const lm of route.landmarks) {
    if (state.seenLandmarks.has(lm.name)) continue;
    if (player.s < lm.s - 45) continue;
    state.seenLandmarks.add(lm.name);
    if (lm.s > 1) hud.banner(lm);
  }

  // 高輪大木戸の開閉
  const gateClosed = clock.minutes >= KURE_MUTSU;
  landmarks.setGateClosed(gateClosed && player.s < okido.s);

  if (okido) {
    if (state.okidoPassedAt === null && player.s >= okido.s) {
      state.okidoPassedAt = clock.minutes;
      if (!gateClosed) hud.toast('高輪大木戸を抜けた。ここから先は江戸の外。', { strong: true });
    }
    if (gateClosed && player.s < okido.s) {
      // 閉じた木戸は押しても開かぬ
      if (player.s > okido.s - 3.2) {
        player.s = okido.s - 3.2;
        player.speed = 0;
        finish('gate');
        return;
      }
    }
  }

  if (player.s >= route.length - 0.5) {
    finish('arrived');
    return;
  }

  placeCamera(false);
  const k = 1 - Math.exp(-CAMERA.lag * dtWall);
  camera.position.lerp(camTarget, k);

  const targetFov = CAMERA.fov + (player.speed > SPEED.run * 1.05 ? 5 : 0);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dtWall * 4);
  camera.updateProjectionMatrix();

  sky.update(clock, camera.position);
  hud.update({ player, clock, gateClosed });
}

/* ------------------------------------------------------------ 画面 */

function fmtMinutes(m) {
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return h > 0 ? `${h} 時間 ${mm} 分` : `${mm} 分`;
}

function showResult(kind) {
  const el = document.getElementById('result-screen');
  const title = document.getElementById('result-title');
  const sub = document.getElementById('result-sub');
  const table = document.getElementById('result-table');

  const elapsed = state.finishedAt - START_TIME_MINUTES;
  const covered = player.s;
  const avg = elapsed > 0 ? (covered / (elapsed * 60)) * 3.6 : 0;

  const rows = [
    ['走った里程', `${(covered / 1000).toFixed(2)} km / ${(route.length / 1000).toFixed(2)} km`],
    ['要した刻', fmtMinutes(elapsed)],
    ['平均の脚', `${avg.toFixed(1)} km/h`],
    ['着いた刻', clock.label],
  ];
  if (state.okidoPassedAt !== null) {
    rows.push(['大木戸を抜けた刻', `暮六つの ${Math.round(KURE_MUTSU - state.okidoPassedAt)} 分前`]);
  }
  rows.push(['咎め', `${state.penalties} 度`]);
  rows.push(['人にぶつかった', `${state.bumps} 度`]);

  if (kind === 'arrived') {
    title.textContent = '品川宿 着';
    sub.textContent =
      state.penalties === 0
        ? '滞りなく継立の問屋場へ入った。次の飛脚が川崎へ発つ。'
        : '道中で咎めを受けたが、ともかく荷は届いた。';
  } else {
    title.textContent = '閉門';
    sub.textContent = '暮六つ。高輪大木戸は閉じられた。明六つまで江戸を出られぬ。';
  }

  table.innerHTML = rows
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
    .join('');

  el.hidden = false;
}

/* ------------------------------------------------------------ 起動 */

const brief = document.getElementById('title-brief');
const startButton = document.getElementById('start-button');

brief.innerHTML = [
  `実延長 <b>${(route.length / 1000).toFixed(2)} km</b>（史料の二里 = 7.85 km）`,
  `標高 <b>${route.stats.minElevation} 〜 ${route.stats.maxElevation} m</b> / 最急 <b>${route.stats.maxGradePermil} ‰</b>`,
  `暮六つに <b>高輪大木戸</b> が閉じる。出立は四半刻前。`,
].join('<br>');

startButton.disabled = false;
startButton.addEventListener('click', start);
document.getElementById('retry-button').addEventListener('click', start);

placeCamera(true);
sky.update(clock, camera.position);
requestAnimationFrame(frame);

/**
 * 開発用の窓口。ブラウザのコンソールから触れる。
 *   __hikyaku.jump(5600)      高輪大木戸の手前へ飛ぶ
 *   __hikyaku.tick(1/60, 600) 描画が止まっている環境で手回しする
 */
window.__hikyaku = {
  THREE, renderer, scene, camera, route, player, crowd, landmarks, sky, clock, hud, state,
  start,
  jump(s, minutes) {
    if (state.phase !== 'running') start();
    player.s = THREE.MathUtils.clamp(s, 0, route.length);
    player.u = 0;
    player.speed = 0;
    player.stunUntil = 0;
    if (minutes !== undefined) clock.minutes = minutes;
    for (const lm of route.landmarks) {
      if (lm.s < player.s) state.seenLandmarks.add(lm.name);
    }
    placeCamera(true);
    sky.update(clock, camera.position);
    hud.update({ player, clock, gateClosed: clock.minutes >= KURE_MUTSU });
  },
  tick(dtWall = 1 / 60, n = 1) {
    for (let i = 0; i < n && state.phase === 'running'; i++) step(dtWall);
    renderer.render(scene, camera);
  },
  render() {
    renderer.render(scene, camera);
  },
  hold(keys) {
    for (const k of Object.keys(input)) input[k] = false;
    for (const k of keys) input[k] = true;
  },
  /** 描画結果を開発サーバへ送って .capture/ に保存する (dev のみ)。 */
  async capture(name, w = 1100, h = 620) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    const res = await fetch(`/__capture?name=${name}`, { method: 'POST', body: url });
    return res.text();
  },
};
