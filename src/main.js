import * as THREE from 'three';
import './styles.css';
import { Route } from './core/route.js';
import { PALETTE, toonGradient } from './core/palette.js';
import { CAMERA, FOG, FAST_FORWARD, SPEED, TIME_SCALE } from './core/config.js';
import { buildTerrain, makeRoadTexture, makeSeaTexture } from './game/terrain.js';
import { buildTownscape } from './game/townscape.js';
import { Landmarks } from './game/landmarks.js';
import { Crowd } from './game/obstacles.js';
import { Player } from './game/player.js';
import { Hud } from './game/hud.js';
import { Minimap } from './game/minimap.js';
import { EdoClock } from './game/time.js';
import { Sky } from './game/sky.js';

import manifest from './data/routes.generated.json';

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

const materials = {
  gradient,
  ground: toon(0xffffff, { vertexColors: true }),
  road: toon(0xffffff, { map: makeRoadTexture() }),
  sea: toon(0xffffff, { map: makeSeaTexture() }),
  building: toon(0xffffff),
  roof: toon(0xffffff),
  eaves: toon(0x3b2f24),
  shopfront: toon(0x6b5236),
  noren: toon(0xffffff),
  wood: toon(PALETTE.ki),
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

const sky = new Sky(scene);
sky.water = materials.sea;
scene.fog.near = FOG.near;
scene.fog.far = FOG.far;

/* --------------------------------------------------------- 街道の読込 */

/** 小地図の下敷き（public/maps/index.json）。 */
let mapIndex = {};

/** いま組み立てられている街道一式。 */
let stage = null;

async function buildStage(id) {
  disposeStage();

  const data = (await import(`./data/${id}.generated.json`)).default;
  const route = new Route(data);
  const landmarks = new Landmarks(route, materials);
  const crowd = new Crowd(route, materials);
  const player = new Player(route, landmarks, materials);

  const groups = [
    buildTerrain(route, materials),
    buildTownscape(route, materials),
    landmarks.group,
    crowd.group,
    player.group,
  ];
  for (const g of groups) scene.add(g);

  const clock = new EdoClock(route.startTimeMinutes);
  const hud = new Hud(route);
  const minimap = mapIndex[id] ? new Minimap(route, mapIndex[id]) : null;
  const gateLandmark = route.gateLandmark;

  stage = {
    id, route, landmarks, crowd, player, clock, hud, minimap, groups, gateLandmark,
    phase: 'idle',
    seenLandmarks: new Set(),
    penalties: 0,
    bumps: 0,
    gatePassedAt: null,
    finishedAt: null,
  };
  placeCamera(true);
  sky.update(clock, camera.position);
  return stage;
}

function disposeStage() {
  if (!stage) return;
  stage.minimap?.hide();
  stage.minimap?.destroy();
  stage.hud.hide();
  for (const g of stage.groups) {
    scene.remove(g);
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
  stage = null;
}

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
    if (stage && stage.phase !== 'idle') startRun();
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

function startRun() {
  const st = stage;
  st.clock.reset();
  st.player.reset();
  st.crowd.reset();
  st.landmarks.setGateClosed(false);
  st.seenLandmarks.clear();
  st.penalties = 0;
  st.bumps = 0;
  st.gatePassedAt = null;
  st.finishedAt = null;
  st.phase = 'running';

  document.getElementById('title-screen').hidden = true;
  document.getElementById('result-screen').hidden = true;
  st.hud.show();
  st.minimap?.show();
  placeCamera(true);
  st.hud.banner(st.route.landmarks[0]);
}

function finish(kind) {
  stage.phase = 'result';
  stage.finishedAt = stage.clock.minutes;
  stage.hud.hide();
  stage.minimap?.hide();
  showResult(kind);
}

function backToTitle() {
  if (stage) {
    stage.phase = 'idle';
    stage.hud.hide();
    stage.minimap?.hide();
  }
  document.getElementById('result-screen').hidden = true;
  document.getElementById('title-screen').hidden = false;
}

/* ------------------------------------------------------------ カメラ */

const camTarget = new THREE.Vector3();
const camLook = new THREE.Vector3();
const sm = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(), left: new THREE.Vector3() };

function placeCamera(snap) {
  const { route, landmarks, player } = stage;
  route.sample(player.s, player.u * 0.5, sm);
  camTarget.set(sm.pos.x, sm.pos.y + landmarks.liftAt(player.s) + CAMERA.height, sm.pos.z);
  camTarget.addScaledVector(sm.tangent, -CAMERA.distance);
  if (snap) camera.position.copy(camTarget);

  const ahead = player.s + CAMERA.lookAhead;
  route.sample(ahead, player.u * 0.35, sm);
  camLook.set(sm.pos.x, sm.pos.y + landmarks.liftAt(ahead) + CAMERA.lookHeight, sm.pos.z);
  camera.lookAt(camLook);
}

/* ------------------------------------------------------------ ループ */

let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dtWall = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (stage) {
    if (stage.phase === 'running') step(dtWall);
    else sky.update(stage.clock, camera.position);
  }
  renderer.render(scene, camera);
}

function step(dtWall) {
  const { route, landmarks, crowd, player, clock, hud, minimap, gateLandmark } = stage;
  const dt = dtWall * TIME_SCALE * (input.fast ? FAST_FORWARD : 1);

  clock.advance(dt);
  player.update(dt, input, clock.minutes);
  input.jump = false;

  for (const ev of crowd.update(dt, player, clock.minutes)) {
    if (ev.type === 'rude') {
      stage.penalties += 1;
      hud.toast(`${ev.title} — ${ev.text}`, { strong: true });
    } else if (ev.type === 'warn') {
      hud.toast(`${ev.title} — ${ev.text}`, { strong: true });
    } else if (ev.type === 'bump') {
      stage.bumps += 1;
      hud.toast(ev.text);
    } else {
      hud.toast(ev.text);
    }
  }

  for (const lm of route.landmarks) {
    if (stage.seenLandmarks.has(lm.name)) continue;
    if (player.s < lm.s - 45) continue;
    stage.seenLandmarks.add(lm.name);
    if (lm.s > 1) hud.banner(lm);
  }

  // 大木戸の開閉
  const closesAt = route.gate?.closesAtMinutes ?? Infinity;
  const gateClosed = clock.minutes >= closesAt;
  if (gateLandmark) {
    landmarks.setGateClosed(gateClosed && player.s < gateLandmark.s);

    if (stage.gatePassedAt === null && player.s >= gateLandmark.s) {
      stage.gatePassedAt = clock.minutes;
      if (!gateClosed) hud.toast(route.gate.passText, { strong: true });
    }
    if (gateClosed && player.s < gateLandmark.s && player.s > gateLandmark.s - 3.2) {
      player.s = gateLandmark.s - 3.2;
      player.speed = 0;
      finish('gate');
      return;
    }
  }

  if (player.s >= route.length - 0.5) {
    finish('arrived');
    return;
  }

  placeCamera(false);
  camera.position.lerp(camTarget, 1 - Math.exp(-CAMERA.lag * dtWall));

  const targetFov = CAMERA.fov + (player.speed > SPEED.run * 1.05 ? 5 : 0);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dtWall * 4);
  camera.updateProjectionMatrix();

  sky.update(clock, camera.position);
  hud.update({ player, clock, gateClosed });
  minimap?.update(player);
}

/* ------------------------------------------------------------ 画面 */

function fmtMinutes(m) {
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return h > 0 ? `${h} 時間 ${mm} 分` : `${mm} 分`;
}

function showResult(kind) {
  const { route, player, clock, gateLandmark } = stage;
  const el = document.getElementById('result-screen');
  const elapsed = stage.finishedAt - route.startTimeMinutes;
  const avg = elapsed > 0 ? (player.s / (elapsed * 60)) * 3.6 : 0;

  const rows = [
    ['街道', `${route.road}　${route.name}`],
    ['走った里程', `${(player.s / 1000).toFixed(2)} km / ${(route.length / 1000).toFixed(2)} km`],
    ['要した刻', fmtMinutes(elapsed)],
    ['平均の脚', `${avg.toFixed(1)} km/h`],
    ['着いた刻', clock.label],
  ];
  if (stage.gatePassedAt !== null && route.gate) {
    const margin = Math.round(route.gate.closesAtMinutes - stage.gatePassedAt);
    rows.push([`${gateLandmark.name}を抜けた刻`, `暮六つの ${margin} 分前`]);
  }
  rows.push(['咎め', `${stage.penalties} 度`]);
  rows.push(['人にぶつかった', `${stage.bumps} 度`]);

  if (kind === 'arrived') {
    document.getElementById('result-title').textContent = `${route.meta.to} 着`;
    document.getElementById('result-sub').textContent =
      stage.penalties === 0
        ? '滞りなく継立の問屋場へ入った。次の飛脚が先へ発つ。'
        : '道中で咎めを受けたが、ともかく荷は届いた。';
  } else {
    document.getElementById('result-title').textContent = route.gate.failTitle;
    document.getElementById('result-sub').textContent = route.gate.failText;
  }

  document.getElementById('result-table').innerHTML = rows
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
    .join('');
  el.hidden = false;
}

/* ------------------------------------------------------------ 街道選び */

const startButton = document.getElementById('start-button');
const brief = document.getElementById('title-brief');
let selectedId = manifest.routes[0].id;

function renderStageList() {
  const list = document.getElementById('stage-list');
  list.innerHTML = manifest.routes
    .map(
      (r) => `
      <button class="stage-card${r.id === selectedId ? ' on' : ''}" data-id="${r.id}">
        <span class="stage-road">${r.road}</span>
        <span class="stage-name">${r.from} — ${r.to}</span>
        <span class="stage-figures">${(r.totalLength / 1000).toFixed(2)} km ／ 標高 ${r.stats.minElevation}–${r.stats.maxElevation} m</span>
      </button>`
    )
    .join('');

  for (const card of list.querySelectorAll('.stage-card')) {
    card.addEventListener('click', () => selectStage(card.dataset.id));
  }
}

async function selectStage(id) {
  selectedId = id;
  renderStageList();
  const r = manifest.routes.find((x) => x.id === id);
  brief.innerHTML = `${r.summary}<br>実延長 <b>${(r.totalLength / 1000).toFixed(2)} km</b>（史料の${r.historicalDistance.ri === 2 ? '二里' : `${r.historicalDistance.ri}里`} = ${r.historicalDistance.km} km）　最急 <b>${r.stats.maxGradePermil} ‰</b>`;

  startButton.disabled = true;
  startButton.textContent = '支度中…';
  await buildStage(id);
  const grace = (stage.route.gate?.closesAtMinutes ?? 0) - stage.route.startTimeMinutes;
  brief.innerHTML += `<br>暮六つに <b>${stage.gateLandmark?.name ?? '大木戸'}</b> が閉じる。出立はその ${grace} 分前。`;
  startButton.textContent = '出立';
  startButton.disabled = false;
}

startButton.addEventListener('click', startRun);
document.getElementById('retry-button').addEventListener('click', startRun);
document.getElementById('back-button').addEventListener('click', backToTitle);

/* ------------------------------------------------------------ 起動 */

async function boot() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}maps/index.json`);
    if (res.ok) mapIndex = await res.json();
  } catch {
    // 小地図なしでも遊べる
  }
  renderStageList();
  await selectStage(selectedId);
  requestAnimationFrame(frame);
}

boot();

/**
 * 開発用の窓口。ブラウザのコンソールから触れる。
 *   __hikyaku.jump(5600)      大木戸の手前へ飛ぶ
 *   __hikyaku.tick(1/60, 600) 描画が止まっている環境で手回しする
 */
window.__hikyaku = {
  THREE, renderer, scene, camera, sky, manifest,
  get stage() { return stage; },
  get route() { return stage.route; },
  get player() { return stage.player; },
  get clock() { return stage.clock; },
  get state() { return stage; },
  select: selectStage,
  start: startRun,
  jump(s, minutes) {
    if (stage.phase !== 'running') startRun();
    const { route, player, clock, hud } = stage;
    player.s = THREE.MathUtils.clamp(s, 0, route.length);
    player.u = 0;
    player.speed = 0;
    player.stunUntil = 0;
    if (minutes !== undefined) clock.minutes = minutes;
    for (const lm of route.landmarks) {
      if (lm.s < player.s) stage.seenLandmarks.add(lm.name);
    }
    placeCamera(true);
    sky.update(clock, camera.position);
    hud.update({ player, clock, gateClosed: clock.minutes >= (route.gate?.closesAtMinutes ?? Infinity) });
    stage.minimap?.update(player);
  },
  tick(dtWall = 1 / 60, n = 1) {
    for (let i = 0; i < n && stage.phase === 'running'; i++) step(dtWall);
    renderer.render(scene, camera);
  },
  render() {
    renderer.render(scene, camera);
  },
  hold(keys) {
    for (const k of Object.keys(input)) input[k] = false;
    for (const k of keys) input[k] = true;
  },
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
