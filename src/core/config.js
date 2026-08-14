/**
 * 調整値。
 *
 * 距離と標高は実測そのままなので、遊べる長さに収めるのは時間の圧縮で行う。
 * TIME_SCALE=3 のとき、実時間 1 秒がゲーム内 3 秒に相当する。
 * 飛脚の速度は「ゲーム内秒あたりの実距離」で与えてあるので、
 * 走破に要する *ゲーム内* 時間は史実どおり(二里を約半刻)になり、
 * プレイヤーが座っている実時間だけが 1/3 に縮む。
 */
export const TIME_SCALE = 3;

/** 早駆け(開発・実演用)。押している間さらに速く進む。 */
export const FAST_FORWARD = 5;

export const SPEED = {
  /** 歩き 5.8 km/h */
  walk: 1.6,
  /** 並の走り 16 km/h — 飛脚の巡航 */
  run: 4.5,
  /** 全力 22 km/h — 息が続かない */
  sprint: 6.2,
  /** 加速・減速 (m/s^2) */
  accel: 3.2,
  brake: 5.0,
  /** 左右への移動 (m/s) */
  strafe: 3.4,
};

/**
 * 息の配分。
 * 飛脚は走るのが商売なので、巡航の走りはほぼ持続できる。
 * 削られるのは全力疾走と上り坂で、八ツ山の登りは息の大半を持っていく。
 */
export const STAMINA = {
  max: 100,
  /** 毎ゲーム内秒の消耗 */
  runDrain: 0.12,
  sprintDrain: 5.5,
  /** 歩き・停止時の回復 */
  walkRecover: 5.0,
  idleRecover: 8.0,
  /** 勾配 1‰ あたりの追加消耗 (上りのみ) */
  gradePenalty: 0.025,
  /** 息が切れると走れなくなる。この値まで戻れば再び走れる。 */
  exhaustedUntil: 22,
};

/** 高輪大木戸は暮六つに閉じる。出立はその四半刻(30分)前。 */
export const START_TIME_MINUTES = 17 * 60 + 30;

export const CAMERA = {
  distance: 7.4,
  height: 3.0,
  lookAhead: 9.0,
  lookHeight: 1.3,
  fov: 62,
  /** 追従の緩さ (小さいほど滑らか) */
  lag: 4.5,
};

export const FOG = { near: 40, far: 340 };

/** 沿道の生成に使う種。変えると町並みが変わる。 */
export const WORLD_SEED = 1603;
