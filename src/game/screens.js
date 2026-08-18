/**
 * 題名・街道選び・結果の画面。
 *
 * 3D とは関わりがなく、DOM を書き換えるだけ。
 * 走っている最中の HUD は hud.js が持つ。
 */

/** 里程を漢数字で。二里十丁のように読ませる。 */
export function kanjiNum(n) {
  const D = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return D[n];
  if (n < 20) return `十${n % 10 ? D[n % 10] : ''}`;
  return `${D[Math.floor(n / 10)]}十${n % 10 ? D[n % 10] : ''}`;
}

export function fmtMinutes(m) {
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return h > 0 ? `${h} 時間 ${mm} 分` : `${mm} 分`;
}

/**
 * 街道の一覧を並べ替える。
 * @param onSelect 札を押したときに呼ぶ
 */
export function renderStageList(manifest, selectedId, onSelect) {
  const list = document.getElementById('stage-list');
  list.innerHTML = manifest.routes
    .map(
      (r) => `
      <button class="stage-card${r.id === selectedId ? ' on' : ''}" data-id="${r.id}">
        <span class="stage-road">${r.road}</span>
        <span class="stage-name">${r.from} — ${r.to}</span>
      </button>`
    )
    .join('');

  for (const card of list.querySelectorAll('.stage-card')) {
    card.addEventListener('click', () => onSelect(card.dataset.id));
  }
}

/**
 * 街道の触れ込み。目録（routes.generated.json）だけで書けるぶん。
 * 支度が済む前に出したいので、組み立て済みの街道は要らない。
 */
export function routeBrief(r) {
  // 街道なら史料の里程と並べる。里程の定めが無い道は実測だけを出す。
  const hd = r.historicalDistance ?? {};
  const ri = hd.ri ? `${kanjiNum(hd.ri)}里${hd.cho ? `${kanjiNum(hd.cho)}丁` : ''}` : null;
  const dist = ri
    ? `実延長 <b>${(r.totalLength / 1000).toFixed(2)} km</b>（史料の${ri} = ${hd.km} km）`
    : `実延長 <b>${(r.totalLength / 1000).toFixed(2)} km</b>（里程の定めは無い道）`;
  return `${r.summary}<br>${dist}　最急 <b>${r.stats.maxGradePermil} ‰</b>`;
}

/** 刻限の触れ込み。組み立てが済んでから足す。 */
export function gateBrief(route, gateLandmark) {
  // 大木戸は門が閉まる。宿場や町は閉まらないので、刻限として言う。
  const gate = route.gate;
  const grace = (gate?.closesAtMinutes ?? 0) - route.startTimeMinutes;
  const name = gateLandmark?.name ?? '大木戸';
  return gate?.kind === 'keijitsu'
    ? `<br>暮六つが <b>${name}</b> までの刻限。出立はその ${grace} 分前。`
    : `<br>暮六つに <b>${name}</b> が閉じる。出立はその ${grace} 分前。`;
}

/** 道中の帳尻。着いたか、門で止められたか。 */
export function showResult(stage, kind) {
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
  let late = false;
  if (stage.gatePassedAt !== null && route.gate) {
    const margin = Math.round(route.gate.closesAtMinutes - stage.gatePassedAt);
    late = margin < 0;
    const label = route.gate.kind === 'keijitsu' ? '刻限' : `${gateLandmark.name}を抜けた刻`;
    rows.push([label, late ? `刻限を ${-margin} 分過ぎた` : `刻限の ${margin} 分前`]);
  }
  rows.push(['咎め', `${stage.penalties} 度`]);
  rows.push(['人にぶつかった', `${stage.bumps} 度`]);

  if (kind === 'arrived') {
    document.getElementById('result-title').textContent = late ? '遅参' : `${route.meta.to} 着`;
    document.getElementById('result-sub').textContent = late
      ? (route.gate.lateText ?? '刻限に遅れた。継飛脚の名折れである。')
      : stage.penalties === 0
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
