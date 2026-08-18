import * as THREE from 'three';
import './styles.css';
import { Route } from './core/route.js';
import { CAMERA, FOG, FAST_FORWARD, LOOK, TIME_SCALE } from './core/config.js';
import { buildTerrain } from './game/terrain.js';
import { createMaterials } from './game/materials.js';
import { ChaseCamera } from './game/camera.js';
import { renderStageList, routeBrief, gateBrief, showResult } from './game/screens.js';
import { buildTownscape } from './game/townscape.js';
import { Landmarks } from './game/landmarks.js';
import { Crowd } from './game/obstacles.js';
import { Player } from './game/player.js';
import { Hud } from './game/hud.js';
import { Minimap } from './game/minimap.js';
import { EdoClock } from './game/time.js';
import { Sky } from './game/sky.js';
import { Distance } from './game/distance.js';
import { TouchControls, isCoarsePointer } from './game/touch.js';
import { lockViewportScale } from './core/viewport.js';

import manifest from './data/routes.generated.json';

/**
 * 触れて操る端末かどうか。
 * 携帯では鍵盤が無いので操作を差し替え、描画も控えめにする。
 */
const COARSE = isCoarsePointer();

// つまんで拡大されると HUD も操作盤もずれ、しかも戻せなくなる。
if (COARSE) lockViewportScale();

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({
  canvas,
  // 携帯は画素密度が高いので、多重標本化まで掛けると割に合わない
  antialias: !COARSE,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, COARSE ? 1.75 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.3, 3000);
/** 背中を追うカメラ。よそ見の角もここが持つ。 */
const chase = new ChaseCamera(camera);
/** よそ見の向き。ドラッグと操作盤から読む。 */
const look = chase.look;

/* ------------------------------------------------------------- 材質 */

const materials = createMaterials();

const sky = new Sky(scene);
sky.water = materials.sea;
sky.distance = new Distance(scene);
scene.fog.near = FOG.near;
scene.fog.far = FOG.far;

/* --------------------------------------------------------- 街道の読込 */

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
  const minimap = new Minimap(route);
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
  chase.reset();
  chase.place(stage, true);
  sky.update(clock, camera.position);
  return stage;
}

function disposeStage() {
  if (!stage) return;
  stage.minimap?.hide();
  stage.minimap?.destroy();
  stage.hud.hide();
  stage.hud.destroy();
  for (const g of stage.groups) {
    scene.remove(g);
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
  stage = null;
}

/* ------------------------------------------------------------- 入力 */

const input = {
  forward: false, back: false, left: false, right: false,
  sprint: false, jump: false, fast: false,
  lookLeft: false, lookRight: false,
};
const KEYS = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyQ: 'lookLeft', KeyE: 'lookRight',
  KeyF: 'fast',
};

/** よそ見の引き量。マウスの右ドラッグと画面のなぞりで共用する。 */
const dragLook = { active: false, yaw: 0, pitch: 0 };

if (!COARSE) {
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 2) return;
    dragLook.active = true;
    dragLook.yaw = look.yaw;
    dragLook.pitch = look.pitch;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragLook.active) return;
    dragLook.yaw -= THREE.MathUtils.degToRad(e.movementX * LOOK.mouseYaw);
    dragLook.pitch -= THREE.MathUtils.degToRad(e.movementY * LOOK.mousePitch);
  });
  const releaseLook = () => {
    dragLook.active = false;
  };
  canvas.addEventListener('pointerup', releaseLook);
  canvas.addEventListener('pointercancel', releaseLook);
}

/** 携帯の操作盤。触れる端末のときだけ現れる。 */
const touch = COARSE
  ? new TouchControls(
      input,
      dragLook,
      {
        yaw: THREE.MathUtils.degToRad(LOOK.touchYaw),
        pitch: THREE.MathUtils.degToRad(LOOK.touchPitch),
      },
      () => look
    )
  : null;

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
  dragLook.active = false;
  touch?.reset();
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
  touch?.reset();
  if (touch) document.getElementById('touch').hidden = false;
  chase.reset();
  chase.place(stage, true);
  st.hud.banner(st.route.landmarks[0]);
}

function finish(kind) {
  stage.phase = 'result';
  stage.finishedAt = stage.clock.minutes;
  stage.hud.hide();
  stage.minimap?.hide();
  hideTouch();
  showResult(stage, kind);
}

function hideTouch() {
  if (!touch) return;
  touch.reset();
  document.getElementById('touch').hidden = true;
}

function backToTitle() {
  if (stage) {
    stage.phase = 'idle';
    stage.hud.hide();
    stage.minimap?.hide();
    hideTouch();
  }
  document.getElementById('result-screen').hidden = true;
  document.getElementById('title-screen').hidden = false;
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
    // 見どころでは、どちらを向けば何が見えるかを報せる
    if (lm.lookHint) hud.toast(lm.lookHint, { strong: true });
  }

  // 刻限。大木戸のある街道は門が閉まって通れなくなり、
  // 無い街道は問屋場への継立の刻限として効く（遅れれば遅参）。
  const closesAt = route.gate?.closesAtMinutes ?? Infinity;
  const gateClosed = clock.minutes >= closesAt;
  const blocks = route.gate?.kind !== 'keijitsu';

  if (gateLandmark) {
    if (blocks) landmarks.setGateClosed(gateClosed && player.s < gateLandmark.s);

    if (stage.gatePassedAt === null && player.s >= gateLandmark.s) {
      stage.gatePassedAt = clock.minutes;
      if (!gateClosed && route.gate.passText) hud.toast(route.gate.passText, { strong: true });
    }
    if (blocks && gateClosed && player.s < gateLandmark.s && player.s > gateLandmark.s - 3.2) {
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

  chase.aim(dtWall, input, dragLook);
  chase.place(stage, false);
  chase.follow(dtWall, player);

  // 横を向いたら霞を払う。海や城を遠くまで見せるため。
  const wantFar = FOG.far + (LOOK.fogFarLookaway - FOG.far) * chase.away;
  scene.fog.far += (wantFar - scene.fog.far) * Math.min(1, dtWall * 2.5);

  sky.update(clock, camera.position);

  // HUD は DOM の書き換えなので毎コマは要らない。数値の動きは遅い。
  hudTimer -= dtWall;
  if (hudTimer <= 0) {
    hudTimer = HUD_INTERVAL;
    hud.update({ player, clock, gateClosed });
    minimap?.update(player);
  }
}

/** HUD を書き換える間隔 (秒)。 */
const HUD_INTERVAL = 1 / 15;
let hudTimer = 0;

/* ------------------------------------------------------------ 街道選び */

const startButton = document.getElementById('start-button');
const brief = document.getElementById('title-brief');
let selectedId = manifest.routes[0].id;

function refreshStageList() {
  renderStageList(manifest, selectedId, selectStage);
}

async function selectStage(id) {
  selectedId = id;
  refreshStageList();
  brief.innerHTML = routeBrief(manifest.routes.find((x) => x.id === id));

  startButton.disabled = true;
  startButton.textContent = '支度中…';
  await buildStage(id);
  brief.innerHTML += gateBrief(stage.route, stage.gateLandmark);
  startButton.textContent = '出立';
  startButton.disabled = false;
}

startButton.addEventListener('click', startRun);
document.getElementById('retry-button').addEventListener('click', startRun);
document.getElementById('back-button').addEventListener('click', backToTitle);

/* ------------------------------------------------------------ 起動 */

async function boot() {
  if (COARSE) {
    document.getElementById('title-keys').hidden = true;
    document.getElementById('title-keys-touch').hidden = false;
  }
  refreshStageList();
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
  THREE, renderer, scene, camera, sky, manifest, input, look, touch, coarse: COARSE,
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
    chase.place(stage, true);
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
