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
  /** 左右への移動 (m/s)。倒し具合を掛けた値が実際の速さになる。 */
  strafe: 3.4,
  /**
   * 横移動の追従の速さ。
   * 入力にそのまま追従させると、指が触れた瞬間に全速で横へ飛ぶ。
   * 少し遅らせると、軽く触れたときの動き出しが穏やかになる。
   */
  strafeResponse: 9,
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

export const CAMERA = {
  lookAhead: 9.0,
};

/**
 * 視点。
 *
 * 遠見だけだと自分がどこを走っているのか他人事になる。目線まで寄せると
 * 軒の低さや溝の幅が身体の寸法で分かるようになるので、こちらを既定にする。
 *
 *   distance   … 飛脚の背後へ下がる距離 (m)。0 なら本人の目
 *   height     … 路面からのカメラの高さ (m)
 *   lookHeight … 見る先の高さ (m)
 *   lag        … 追従の緩さ。大きいほど身体に固く付く
 *   bob        … 足に合わせた上下の揺れ (m)
 *   uFollow    … 横ずれをどれだけ追うか。目線は本人なので 1
 */
export const VIEWS = [
  {
    id: 'me',
    name: '目線',
    distance: 0,
    height: 1.63,
    lookHeight: 1.63,
    fov: 74,
    lag: 22,
    bob: 0.055,
    uFollow: 1,
    firstPerson: true,
  },
  {
    id: 'kata',
    name: '肩越し',
    distance: 3.3,
    height: 2.1,
    lookHeight: 1.5,
    fov: 66,
    lag: 8,
    bob: 0.022,
    uFollow: 0.8,
  },
  {
    id: 'tooku',
    name: '遠見',
    distance: 7.4,
    height: 3.0,
    lookHeight: 1.3,
    fov: 62,
    lag: 4.5,
    bob: 0,
    uFollow: 0.5,
  },
];

/**
 * よそ見。
 * 走りながら首を回す。飛脚を軸に camera が回り込むので、
 * 横を向けば海や城が正面に来る。手を離せば進行方向へ戻る。
 */
export const LOOK = {
  /** 左右に振れる角度 (度) */
  maxYaw: 135,
  /** 上下に振れる角度 (度) */
  maxPitch: 26,
  /** キー操作の速さ (度/秒) */
  keySpeed: 150,
  /** マウス 1px あたりの角度 (度) */
  mouseYaw: 0.28,
  mousePitch: 0.2,
  /** 指 1px あたりの角度 (度)。親指の可動域は狭いので大きめに取る。 */
  touchYaw: 0.45,
  touchPitch: 0.3,
  /**
   * 首の動きのばね定数。臨界減衰させるので、振り始めと戻り終わりで
   * 速度が 0 になる。指数減衰だと「最初だけ速くて後は這う」戻り方になり、
   * 前を向き直る瞬間が急に感じられる。
   * 収まるまでおよそ 4/√k 秒。
   */
  stiffness: 13,
  /** 横を向いているあいだは霞を遠くまで払う */
  fogFarLookaway: 1300,
};

export const FOG = { near: 40, far: 340 };

/** 沿道の生成に使う種。変えると町並みが変わる。 */
export const WORLD_SEED = 1603;
