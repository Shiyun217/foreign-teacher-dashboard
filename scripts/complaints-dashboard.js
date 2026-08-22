const fmtInt = new Intl.NumberFormat('zh-CN');
const pct = (value, digits = 1) => value == null ? '—' : `${(value * 100).toFixed(digits)}%`;
const signedInt = (value) => `${value >= 0 ? '+' : ''}${fmtInt.format(value)}`;
const signedPct = (value) => value == null ? '—' : `${value >= 0 ? '+' : ''}${pct(value)}`;
const reasonColors = {
  '缺席/未出现': 'var(--amber)',
  '早退/提前结束': 'var(--coral)',
  '迟到': 'var(--violet)',
  '中途离开/脱岗': '#e49ac8',
  '网络/音视频设备': 'var(--cyan)',
  '教学进度/教材': 'var(--green)',
  '课堂行为/职业规范': '#f39a6b',
  '教学质量/互动': 'var(--blue)',
  '信息不足': '#686e78',
  '其他明确问题': '#858b96',
};
const state = { course: 'paid', period: 'overall', reason: null };

function courseData() {
  return DATA.courses[state.course];
}

function renderCourseTabs() {
  document.getElementById('trialCount').textContent = `${fmtInt.format(DATA.courses.trial.totalComplaints)} 条`;
  document.getElementById('paidCount').textContent = `${fmtInt.format(DATA.courses.paid.totalComplaints)} 条`;
  document.querySelectorAll('.course-tab').forEach(button => {
    const active = button.dataset.course === state.course;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function renderSummary() {
  const data = courseData();
  const unknown2026 = 1 - data.attributionStats.y2026.coverage;
  const h1Direction = data.h1Analysis.delta >= 0 ? '增长' : '下降';
  const leader = data.knownLeader.overall;
  document.getElementById('syncTime').textContent = `数据更新 ${DATA.generatedAt}`;
  document.getElementById('sideDate').textContent = DATA.dataThrough;

  document.getElementById('summaryHeadline').textContent = `H1 投诉${h1Direction}，${leader?.reason ?? '高频问题'}为首因`;
  document.getElementById('summaryTitle1').textContent = `上半年投诉量${h1Direction}`;
  document.getElementById('summaryBody1').innerHTML = `2026 H1 为 <em>${fmtInt.format(data.h1Analysis.y2026)}</em> 次，较 2025 H1 的 ${fmtInt.format(data.h1Analysis.y2025)} 次 <em>${signedPct(data.h1Analysis.yoy)}</em>。`;
  document.getElementById('summaryTitle2').textContent = '首要投诉原因';
  document.getElementById('summaryBody2').innerHTML = `${leader?.reason ?? '暂无'}为首因，共 <em>${fmtInt.format(leader?.count ?? 0)}</em> 次，占 ${pct(leader?.share ?? 0)}；2026 可归因率 ${pct(1 - unknown2026)}。`;
  const cards = [
    ['messages-square', `${data.courseType}投诉`, fmtInt.format(data.totalComplaints), '', 'var(--cyan)'],
    ['calendar-range', '2025 全年', fmtInt.format(data.yearCounts['2025']), '', 'var(--blue)'],
    ['calendar-clock', '2026 年至今', fmtInt.format(data.yearCounts['2026']), `截至 ${DATA.dataThrough}`, 'var(--coral)'],
    ['trending-up', 'H1 同比', signedPct(data.h1Analysis.yoy), `同比${data.h1Analysis.delta >= 0 ? '净增' : '减少'} <strong>${fmtInt.format(Math.abs(data.h1Analysis.delta))}</strong> 条`, data.h1Analysis.delta >= 0 ? 'var(--coral)' : 'var(--green)'],
    ['users-round', '投诉学员', fmtInt.format(data.students.totalEntities), `重复投诉率 ${pct(data.students.repeatRate)}`, 'var(--amber)'],
    ['user-round-search', '被投诉外教', fmtInt.format(data.teachers.totalEntities), `重复被投诉率 ${pct(data.teachers.repeatRate)}`, 'var(--green)'],
  ];
  document.getElementById('kpiGrid').innerHTML = cards.map(([icon, label, value, meta, color]) => `
    <article class="kpi-card" style="--accent:${color}"><div class="kpi-top"><span>${label}</span><span class="kpi-icon"><i data-lucide="${icon}" aria-hidden="true"></i></span></div><div class="kpi-value">${value}</div>${meta ? `<div class="kpi-meta">${meta}</div>` : ''}</article>
  `).join('');
}

function renderMonthlyChart() {
  const data = courseData();
  const el = document.getElementById('monthlyChart');
  const width = Math.max(el.clientWidth, 820), height = 326;
  const pad = { left: 44, right: 18, top: 26, bottom: 54 };
  const plotW = width - pad.left - pad.right, plotH = height - pad.top - pad.bottom;
  const maxValue = Math.max(...data.monthlyComparison.flatMap(row => [row.y2025, row.y2026 ?? 0]), 1);
  const axisMax = maxValue <= 10 ? Math.max(4, maxValue) : Math.ceil(maxValue / 100) * 100;
  const ticks = [0, .25, .5, .75, 1];
  const groupW = plotW / 12, barW = Math.min(22, groupW * .28), gap = 4;
  let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${data.courseType} 2025 与 2026 月度投诉量并列柱状图"><title>${data.courseType}月度投诉量对比</title><desc>每个月包含 2025 和 2026 两个投诉量柱形，2026 年统计到 7 月。</desc>`;
  ticks.forEach(tick => {
    const y = pad.top + plotH * (1 - tick);
    svg += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="rgba(255,255,255,.065)"/><text x="${pad.left - 8}" y="${y + 3}" text-anchor="end" fill="#686e78" font-size="9">${Math.round(axisMax * tick)}</text>`;
  });
  data.monthlyComparison.forEach((row, index) => {
    const center = pad.left + groupW * (index + .5);
    const bars = [{ value: row.y2025, x: center - barW - gap / 2, color: '#4dd7e9', year: 2025 }];
    if (row.y2026 != null) bars.push({ value: row.y2026, x: center + gap / 2, color: '#ff756f', year: 2026 });
    bars.forEach(bar => {
      const barH = bar.value / axisMax * plotH;
      const y = pad.top + plotH - barH;
      svg += `<rect x="${bar.x}" y="${y}" width="${barW}" height="${bar.value ? Math.max(barH, 2) : 1}" rx="3" fill="${bar.color}" opacity="${bar.value ? '.82' : '.22'}"><title>${bar.year} 年 ${row.month} 月：${bar.value} 条</title></rect>`;
      svg += `<text x="${bar.x + barW / 2}" y="${y - 7}" text-anchor="middle" fill="#f4f6f8" font-size="10" font-weight="700">${bar.value}</text>`;
    });
    if (row.y2026 == null) svg += `<line x1="${center + gap / 2}" x2="${center + gap / 2 + barW}" y1="${pad.top + plotH}" y2="${pad.top + plotH}" stroke="#4b5059" stroke-width="2" stroke-dasharray="3 2"><title>2026 年尚未到统计期</title></line>`;
    svg += `<text x="${center}" y="${height - 24}" text-anchor="middle" fill="#c8cdd5" font-size="11" font-weight="650">${String(row.month).padStart(2, '0')}月</text>`;
  });
  svg += '</svg>';
  el.innerHTML = svg;
}

function renderH1() {
  const data = courseData();
  const h = data.h1Analysis, max = Math.max(h.y2025, h.y2026, 1);
  document.getElementById('h1Total').textContent = fmtInt.format(h.y2026);
  document.getElementById('h1Yoy').textContent = signedPct(h.yoy);
  document.getElementById('h1Yoy').style.color = h.delta >= 0 ? 'var(--coral)' : 'var(--green)';
  document.getElementById('h1Delta').textContent = `同比${h.delta >= 0 ? '净增' : '减少'} ${fmtInt.format(Math.abs(h.delta))} 条`;
  document.getElementById('h1Bars').innerHTML = [
    ['2025', h.y2025, 'var(--cyan)'], ['2026', h.y2026, 'var(--coral)']
  ].map(([year, value, color]) => `<div class="compare-row"><span>${year}</span><div class="track"><span style="width:${value / max * 100}%;--bar:${color}"></span></div><strong>${fmtInt.format(value)}</strong></div>`).join('');
  document.getElementById('monthDeltas').innerHTML = h.months.map(item => `<div class="month-delta" style="--tone:${item.delta >= 0 ? 'var(--coral)' : 'var(--green)'}"><span>${item.month} 月同比</span><strong>${signedInt(item.delta)}</strong></div>`).join('');
  const change = data.largestAbsoluteChange;
  document.getElementById('h1Foot').innerHTML = `${change?.month ?? '—'} 月是同比变化最大的月份，较上年同期 <strong>${signedInt(change?.delta ?? 0)}</strong> 次。`;
}

function renderAttribution() {
  const data = courseData();
  const rows = data.attribution[state.period] || [];
  const total = data.attributionStats[state.period]?.total ?? 0;
  document.getElementById('coverageValue').textContent = pct(data.attributionStats[state.period]?.coverage ?? 0);
  const max = Math.max(...rows.map(row => row.count), 1);
  if (!state.reason || !rows.some(row => row.reason === state.reason)) state.reason = data.knownLeader[state.period]?.reason || rows[0]?.reason || null;
  document.getElementById('reasonBars').innerHTML = rows.length ? rows.map(row => `<button class="reason-row ${row.reason === state.reason ? 'active' : ''}" data-reason="${row.reason}" aria-pressed="${row.reason === state.reason}"><span class="reason-label">${row.reason}</span><span class="track"><span style="width:${row.count / max * 100}%;--bar:${reasonColors[row.reason]}"></span></span><strong>${fmtInt.format(row.count)}</strong><span class="reason-share">${pct(row.count / total)}</span></button>`).join('') : '<div class="sample-note">当前周期没有投诉记录。</div>';
  renderFocus();
}

function renderFocus() {
  const data = courseData();
  const rows = data.attribution[state.period] || [];
  const row = rows.find(item => item.reason === state.reason) || rows[0];
  const total = data.attributionStats[state.period]?.total ?? 0;
  document.getElementById('focusReason').textContent = row?.reason ?? '暂无数据';
  document.getElementById('focusCount').textContent = row ? fmtInt.format(row.count) : '0';
  document.getElementById('focusShare').textContent = row ? `占当前视图 ${pct(row.count / total)}` : '当前周期无记录';
  const examples = row ? data.representativeDescriptions[row.reason] || [] : [];
  document.getElementById('examples').innerHTML = examples.slice(0, 5).map(item => `<div class="example"><span title="${item.text.replaceAll('"','&quot;')}">${item.text}</span><b>${fmtInt.format(item.count)}</b></div>`).join('') || '<div class="example"><span>暂无可展示描述</span></div>';
  document.getElementById('focusNote').textContent = row?.reason === '信息不足' ? '编码“1”等内容不是可解释的投诉原因，需补齐原始描述后重新计算。' : '归因采用关键词优先级规则，复杂投诉按首要问题计入一个分类。';
}

function entityMarkup(entity, kind) {
  const maxEntities = Math.max(...entity.buckets.map(item => item.entities), 1);
  const tone = kind === 'student' ? 'var(--amber)' : 'var(--green)';
  return `
    <div class="entity-summary">
      <div class="entity-stat" style="--tone:${tone}"><span>${kind === 'student' ? '投诉学员' : '被投诉外教'}</span><strong>${fmtInt.format(entity.totalEntities)}</strong></div>
      <div class="entity-stat" style="--tone:var(--coral)"><span>出现至少 2 次</span><strong>${fmtInt.format(entity.repeatEntities)}</strong></div>
      <div class="entity-stat" style="--tone:var(--cyan)"><span>最高次数</span><strong>${entity.maximum} 次</strong></div>
    </div>
    <div class="distribution-list">${entity.buckets.map(item => `<div class="distribution-row"><span>${item.label}</span><div class="track"><span style="width:${item.entities / maxEntities * 100}%;--bar:${tone}"></span></div><strong>${fmtInt.format(item.entities)}</strong><em>${pct(item.share)}</em></div>`).join('')}</div>
  `;
}

function renderEntities() {
  const data = courseData();
  document.getElementById('studentAnalysis').innerHTML = entityMarkup(data.students, 'student');
  document.getElementById('teacherAnalysis').innerHTML = entityMarkup(data.teachers, 'teacher');
}

function renderActions() {
  const data = courseData();
  const leader = data.knownLeader.overall;
  const actions = [
    ['calendar-sync', 'P0 · 更新', '定期更新投诉数据', `按固定周期导入最新投诉数据并刷新看板，核对体验课、正价课投诉量及教师 ID，确保业务每次拿到的都是最新结果。`, 'var(--coral)'],
    ['list-filter', 'P0 · 名单', '输出投诉外教名单', `按课程类型整理教师 ID、投诉次数和主要原因；正价课重点输出投诉 ≥ 2 次的全部教师，定期提供给对应业务负责人。`, 'var(--amber)'],
    ['chart-no-axes-column-increasing', 'P1 · 分析', '形成投诉趋势简报', `汇总月度同比、异常增长月份和高占比原因；当前首因是${leader?.reason ?? '高频问题'}，占 ${pct(leader?.share ?? 0)}，将变化与风险点同步给业务。`, 'var(--cyan)'],
    ['clipboard-check', 'P1 · 跟踪', '维护业务反馈台账', `记录投诉名单的同步日期、接收人和业务反馈状态，定期汇总已反馈、处理中和待反馈事项，作为下一次数据更新的跟进依据。`, 'var(--green)'],
  ];
  document.getElementById('actions').innerHTML = actions.map(([icon, priority, title, body, tone]) => `<div class="action-item" style="--tone:${tone}"><div class="action-top"><span class="action-icon"><i data-lucide="${icon}" aria-hidden="true"></i></span><span class="priority">${priority}</span></div><strong>${title}</strong><p>${body}</p></div>`).join('');
}

function renderTeachers() {
  const data = courseData();
  const rows = state.course === 'paid' ? data.repeatComplaintTeachers : data.complaintTeachers;
  document.getElementById('teacherListSub').textContent = state.course === 'paid'
    ? `投诉 ≥ 2 次的全部教师 · ${fmtInt.format(rows.length)} 位`
    : `全部投诉教师 · ${fmtInt.format(rows.length)} 位`;
  document.getElementById('teacherList').innerHTML = rows.map((row, index) => `<div class="teacher-row"><i>#${index + 1}</i><span>${row.teacherId}</span><strong>${row.count} 条</strong></div>`).join('') || '<div class="sample-note">暂无教师投诉记录。</div>';
}

function renderMethodology() {
  document.getElementById('dedupDescription').textContent = `源表共 ${fmtInt.format(DATA.quality.validRows)} 条有效数据行，按新口径归并为 ${fmtInt.format(DATA.quality.deduplicatedComplaints)} 次投诉。${DATA.methodology.countingRule}`;
  document.getElementById('dedupFields').innerHTML = [
    `体验课：${fmtInt.format(DATA.courses.trial.audit.rawValidRows)} 行 → ${fmtInt.format(DATA.courses.trial.audit.studentDayComplaints)} 次投诉`,
    `正价课：${fmtInt.format(DATA.courses.paid.audit.rawValidRows)} 行 → ${fmtInt.format(DATA.courses.paid.audit.studentDayComplaints)} 次投诉`,
    `去重键：${DATA.methodology.dedupKey.join(' + ')}`,
    '同日多条：保留投诉时间最早的一条',
  ].map(text => `<span>${text}</span>`).join('');
  document.getElementById('attributionDescription').textContent = DATA.methodology.attributionRule;
}

function renderAll() {
  renderCourseTabs();
  renderSummary();
  renderMonthlyChart();
  renderH1();
  renderAttribution();
  renderEntities();
  renderActions();
  renderTeachers();
  if (window.lucide) lucide.createIcons();
}

function bindEvents() {
  document.getElementById('courseTabs').addEventListener('click', event => {
    const button = event.target.closest('[data-course]');
    if (!button || button.dataset.course === state.course) return;
    state.course = button.dataset.course;
    state.period = 'overall';
    state.reason = null;
    document.querySelectorAll('.segment').forEach(segment => {
      const active = segment.dataset.period === 'overall';
      segment.classList.toggle('active', active);
      segment.setAttribute('aria-selected', String(active));
    });
    renderAll();
  });
  document.getElementById('periodSegments').addEventListener('click', event => {
    const button = event.target.closest('[data-period]');
    if (!button) return;
    state.period = button.dataset.period;
    state.reason = null;
    document.querySelectorAll('.segment').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    renderAttribution();
  });
  document.getElementById('reasonBars').addEventListener('click', event => {
    const button = event.target.closest('[data-reason]');
    if (!button) return;
    state.reason = button.dataset.reason;
    renderAttribution();
  });
  const dialog = document.getElementById('methodDialog');
  document.getElementById('methodButton').addEventListener('click', () => dialog.showModal());
  document.getElementById('closeMethod').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderMonthlyChart, 120); });
}

function initialize() {
  renderMethodology();
  renderAll();
  bindEvents();
}

initialize();
