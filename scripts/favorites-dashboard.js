const fmtInt = new Intl.NumberFormat('zh-CN');
const fmt1 = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const roleColors = { CC: 'var(--cyan)', SS: 'var(--coral)', LP: 'var(--green)' };
const SYNC_ENDPOINT = String(window.FAVORITES_SYNC_CONFIG?.endpoint || '').replace(/\/$/, '');
const CACHE_KEY = 'business-favorites-shared-v1';
const REQUIRED_HEADERS = ['外教id', '业务类型（港澳-cc/ss/lp）', '业务人员名称', '业务人员id'];
const state = { search: '', role: 'all', group: 'all', sort: 'favorites', direction: 'desc', page: 1, pageSize: 25, upload: null, uploadFile: null, busy: false };

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fixedTarget = (role, baseline) => role === 'LP' ? 250 : Number(baseline) < 150 ? 150 : 250;
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function initialSnapshot() {
  return {
    schemaVersion: 1,
    dataDate: DATA.dataDate,
    comparisonDate: null,
    sourceName: DATA.notes?.find(row => row.item === '收藏明细')?.description?.split('，')[0] || '已发布初始数据',
    sourceRows: DATA.quality?.sourceRows || DATA.overall.totalFavorites,
    uniquePairCount: DATA.quality?.uniqueEmployeeTeacherPairs || DATA.overall.totalFavorites,
    duplicatePairCount: DATA.quality?.duplicateEmployeeTeacherPairs || 0,
    employees: DATA.employees.map(row => ({
      role: row.role,
      id: String(row.id),
      account: row.account,
      group: row.group,
      name: row.name || null,
      target: fixedTarget(row.role, row.favorites),
      favorites: Number(row.favorites) || 0,
      previousFavorites: null,
    })),
  };
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.employees) || !snapshot.employees.length) throw new Error('共享数据格式不正确');
  return {
    ...snapshot,
    employees: snapshot.employees.map(row => {
      const favorites = Number(row.favorites) || 0;
      const previous = row.previousFavorites == null ? null : Number(row.previousFavorites) || 0;
      const target = Number(row.target) || fixedTarget(row.role, favorites);
      return {
        role: row.role,
        id: String(row.id),
        account: row.account,
        group: row.group,
        name: row.name || null,
        target,
        favorites,
        previousFavorites: previous,
        added: previous == null ? null : favorites - previous,
        gapToTarget: Math.max(target - favorites, 0),
        hasFavorites: favorites > 0,
      };
    }),
  };
}

function calculateData(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  const employees = normalized.employees;
  const roles = ['CC', 'SS', 'LP'].map(role => {
    const rows = employees.filter(row => row.role === role);
    const totalFavorites = rows.reduce((sum, row) => sum + row.favorites, 0);
    const activeEmployeeCount = rows.filter(row => row.favorites > 0).length;
    return {
      role,
      employeeCount: rows.length,
      activeEmployeeCount,
      zeroEmployeeCount: rows.length - activeEmployeeCount,
      totalFavorites,
      average: rows.length ? totalFavorites / rows.length : 0,
      median: rows.length ? median(rows.map(row => row.favorites)) : 0,
      activeRate: rows.length ? activeEmployeeCount / rows.length : 0,
    };
  });
  const groupKeys = [...new Set(employees.map(row => `${row.role}\u0000${row.group}`))];
  const groups = groupKeys.map(key => {
    const [role, group] = key.split('\u0000');
    const rows = employees.filter(row => row.role === role && row.group === group);
    const totalFavorites = rows.reduce((sum, row) => sum + row.favorites, 0);
    return { role, group, employeeCount: rows.length, activeEmployeeCount: rows.filter(row => row.favorites > 0).length, totalFavorites, average: totalFavorites / rows.length, median: median(rows.map(row => row.favorites)), max: Math.max(...rows.map(row => row.favorites)) };
  }).sort((a, b) => b.average - a.average || a.group.localeCompare(b.group, 'zh-CN'));
  const bins = [
    { label: '0', match: value => value === 0 },
    { label: '1-9', match: value => value >= 1 && value <= 9 },
    { label: '10-49', match: value => value >= 10 && value <= 49 },
    { label: '50-99', match: value => value >= 50 && value <= 99 },
    { label: '100-299', match: value => value >= 100 && value <= 299 },
    { label: '300-999', match: value => value >= 300 && value <= 999 },
    { label: '1000+', match: value => value >= 1000 },
  ];
  const distribution = bins.map(bin => {
    const rows = employees.filter(row => bin.match(row.favorites));
    return { label: bin.label, total: rows.length, byRole: Object.fromEntries(['CC', 'SS', 'LP'].map(role => [role, rows.filter(row => row.role === role).length])) };
  });
  const totalFavorites = employees.reduce((sum, row) => sum + row.favorites, 0);
  const activeEmployeeCount = employees.filter(row => row.favorites > 0).length;
  return {
    ...normalized,
    roles,
    groups,
    distribution,
    overall: { employeeCount: employees.length, activeEmployeeCount, zeroEmployeeCount: employees.length - activeEmployeeCount, totalFavorites, activeRate: activeEmployeeCount / employees.length },
    notes: [
      { item: '数据快照', description: `${normalized.dataDate}${normalized.comparisonDate ? `（昨日对比 ${normalized.comparisonDate}）` : '（首个目标基线）'}` },
      { item: '收藏明细', description: `${normalized.sourceName || '原始 CSV'}，共 ${fmtInt.format(normalized.sourceRows || 0)} 行，去重后 ${fmtInt.format(normalized.uniquePairCount || 0)} 组员工与外教收藏关系。` },
      { item: '去重方式', description: `按业务人员ID与外教ID去重；发现 ${fmtInt.format(normalized.duplicatePairCount || 0)} 条重复组合。` },
      { item: '员工底表', description: '原始明细不含小组与零收藏员工，因此沿用已校验员工底表补充小组，并保留未出现在当天明细中的员工为零收藏。' },
    ],
  };
}

let dashboardData = calculateData(initialSnapshot());
function roleSummary(role) { return dashboardData.roles.find(row => row.role === role); }
function multiple(a, b) { return b ? `${(a / b).toFixed(1)} 倍` : '-'; }
function toast(message) { const el = document.getElementById('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600); }
function setSync(mode, text) { const dot = document.getElementById('syncDot'); dot.className = `sync-dot ${mode || ''}`; document.getElementById('syncTime').textContent = text; }

function renderSummary() {
  const cc = roleSummary('CC'), ss = roleSummary('SS'), lp = roleSummary('LP');
  document.getElementById('dataDate').textContent = dashboardData.dataDate;
  document.getElementById('sideDate').textContent = dashboardData.dataDate;
  document.getElementById('summaryLpAvg').textContent = fmt1.format(lp.average);
  document.getElementById('summaryLpMultiple').textContent = multiple(lp.average, Math.max(cc.average, ss.average));
  document.getElementById('summaryCcSkew').textContent = multiple(cc.average, cc.median);
  document.getElementById('summarySsSkew').textContent = multiple(ss.average, ss.median);
  document.getElementById('summaryZero').textContent = dashboardData.overall.zeroEmployeeCount;
  document.getElementById('summaryCcZero').textContent = cc.zeroEmployeeCount;
  document.getElementById('summarySsZero').textContent = ss.zeroEmployeeCount;
}

function renderKpis() {
  const cards = dashboardData.roles.map(row => ({
    accent: roleColors[row.role], icon: row.role === 'LP' ? 'headphones' : row.role === 'SS' ? 'messages-square' : 'phone-call',
    label: `${row.role} 端口平均收藏`, value: fmt1.format(row.average), unit: '位 / 人',
    meta: `${row.employeeCount} 名员工 · 中位数 <strong>${fmt1.format(row.median)}</strong> · 有收藏率 <strong>${pct(row.activeRate)}</strong>`,
  }));
  cards.push({ accent: 'var(--amber)', icon: 'users-round', label: '全端口收藏覆盖', value: pct(dashboardData.overall.activeRate), unit: '', meta: `${dashboardData.overall.activeEmployeeCount} / ${dashboardData.overall.employeeCount} 名员工有收藏 · 合计 <strong>${fmtInt.format(dashboardData.overall.totalFavorites)}</strong> 人次` });
  document.getElementById('kpiGrid').innerHTML = cards.map(card => `<article class="kpi-card" style="--accent:${card.accent}"><div class="kpi-top"><span>${card.label}</span><span class="kpi-icon"><i data-lucide="${card.icon}"></i></span></div><div class="kpi-value">${card.value}<span class="kpi-unit">${card.unit}</span></div><div class="kpi-meta">${card.meta}</div></article>`).join('');
}

function renderRoleComparison() {
  const maxAverage = Math.max(...dashboardData.roles.map(row => row.average), 1);
  const header = '<div class="role-row head"><div>端口</div><div>平均收藏</div><div>中位数</div><div>收藏合计</div><div>员工数</div><div>有收藏率</div></div>';
  const rows = dashboardData.roles.map(row => `<div class="role-row" style="--role-color:${roleColors[row.role]}"><div class="role-name">${row.role}</div><div class="average-bar"><div class="track"><span style="width:${row.average / maxAverage * 100}%;--bar:${roleColors[row.role]}"></span></div><strong>${fmt1.format(row.average)}</strong></div><div class="role-stat">${fmt1.format(row.median)}<span>典型水平</span></div><div class="role-stat">${fmtInt.format(row.totalFavorites)}<span>员工去重后合计</span></div><div class="role-stat">${row.employeeCount}<span>${row.zeroEmployeeCount} 人为 0</span></div><div class="role-stat ${row.activeRate === 1 ? 'good' : ''}">${pct(row.activeRate)}<span>${row.activeEmployeeCount} 人有收藏</span></div></div>`).join('');
  document.getElementById('roleComparison').innerHTML = header + rows;
}

function renderInsights() {
  const cc = roleSummary('CC'), ss = roleSummary('SS'), lp = roleSummary('LP');
  const topGroup = dashboardData.groups[0];
  const achieved = dashboardData.employees.filter(row => row.gapToTarget === 0).length;
  const insights = [
    { tone: 'var(--green)', tag: '可复制', title: 'LP 可作为收藏运营标杆', body: `LP 人均 ${fmt1.format(lp.average)}、中位数 ${fmt1.format(lp.median)}，当前 ${lp.activeEmployeeCount} 人有收藏。` },
    { tone: 'var(--amber)', tag: '需校准', title: 'CC / SS 的平均值高于典型水平', body: `CC 人均是中位数的 ${multiple(cc.average, cc.median)}，SS 为 ${multiple(ss.average, ss.median)}；建议同时关注目标差额。` },
    { tone: 'var(--coral)', tag: '优先行动', title: `已有 ${achieved} 人达到固定收藏目标`, body: `仍有 ${dashboardData.employees.length - achieved} 人未达目标，可按“离目标差额”降序安排补充收藏。` },
    { tone: 'var(--cyan)', tag: '小组洞察', title: '小组表现需结合样本量判断', body: `${topGroup.group} 当前人均 ${fmt1.format(topGroup.average)}，共 ${topGroup.employeeCount} 名员工。` },
  ];
  document.getElementById('insightList').innerHTML = insights.map(row => `<div class="insight" style="--tone:${row.tone}"><div class="insight-top"><b>${row.title}</b><i>${row.tag}</i></div><p>${row.body}</p></div>`).join('');
}

function renderDistribution() {
  const max = Math.max(...dashboardData.distribution.map(row => row.total), 1);
  document.getElementById('distribution').innerHTML = dashboardData.distribution.map(row => {
    const width = row.total / max * 100;
    return `<div class="dist-row"><span class="dist-label">${row.label} 位</span><div class="stack" title="CC ${row.byRole.CC} / SS ${row.byRole.SS} / LP ${row.byRole.LP}"><span style="width:${row.total ? row.byRole.CC / row.total * width : 0}%;background:var(--cyan)"></span><span style="width:${row.total ? row.byRole.SS / row.total * width : 0}%;background:var(--coral)"></span><span style="width:${row.total ? row.byRole.LP / row.total * width : 0}%;background:var(--green)"></span></div><strong class="dist-total">${row.total}</strong></div>`;
  }).join('');
  const below50 = dashboardData.distribution.filter(row => ['0', '1-9', '10-49'].includes(row.label)).reduce((sum, row) => sum + row.total, 0);
  const above300 = dashboardData.distribution.filter(row => ['300-999', '1000+'].includes(row.label)).reduce((sum, row) => sum + row.total, 0);
  document.getElementById('distributionNote').textContent = `${below50} 名员工收藏少于 50 位，占全体 ${pct(below50 / dashboardData.overall.employeeCount)}；收藏 300 位以上的员工共 ${above300} 名。`;
}

function renderGroups() {
  document.getElementById('groupList').innerHTML = dashboardData.groups.slice(0, 10).map((row, index) => `<div class="group-row" style="--role-color:${roleColors[row.role]}"><span class="group-rank">${String(index + 1).padStart(2, '0')}</span><div class="group-name"><b>${row.role}</b>${escapeHtml(row.group)}</div><div class="group-stat">${row.employeeCount}<span>员工</span></div><div class="group-stat">${fmt1.format(row.average)}<span>平均</span></div><div class="group-stat">${fmt1.format(row.median)}<span>中位数</span></div></div>`).join('');
}

function aggregateEmployees(rows, label, role, total = false) {
  const previousAvailable = rows.every(row => row.previousFavorites != null);
  const current = rows.reduce((sum, row) => sum + row.favorites, 0);
  const previous = previousAvailable ? rows.reduce((sum, row) => sum + row.previousFavorites, 0) : null;
  const added = previous == null ? null : current - previous;
  const achieved = rows.filter(row => row.favorites >= row.target).length;
  return {
    label, role, total,
    employeeCount: rows.length,
    target: rows.reduce((sum, row) => sum + row.target, 0),
    current, previous, added,
    growth: previous > 0 ? added / previous : null,
    achieved,
    achievementRate: rows.length ? achieved / rows.length : 0,
  };
}

function renderGroupSummary() {
  const rows = [];
  for (const role of ['CC', 'SS', 'LP']) {
    const roleRows = dashboardData.employees.filter(row => row.role === role);
    const groups = [...new Set(roleRows.map(row => row.group))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    groups.forEach(group => rows.push(aggregateEmployees(roleRows.filter(row => row.group === group), group, role)));
    rows.push(aggregateEmployees(roleRows, `${role}端口汇总`, role, true));
  }
  document.getElementById('groupSummaryBody').innerHTML = rows.map((row, index) => {
    const isPortStart = index === 0 || rows[index - 1].role !== row.role;
    const addedClass = row.added > 0 ? 'delta-up' : row.added < 0 ? 'delta-down' : '';
    const added = row.added == null ? '--' : `${row.added > 0 ? '+' : ''}${fmtInt.format(row.added)}`;
    const growth = row.growth == null ? '--' : `${row.growth > 0 ? '+' : ''}${pct(row.growth)}`;
    return `<tr class="${isPortStart ? 'port-start ' : ''}${row.total ? 'port-total' : ''}" style="--role-color:${roleColors[row.role]}"><td>${row.total ? escapeHtml(row.label) : `<span class="role-pill">${row.role}</span> ${escapeHtml(row.label)}`}</td><td class="num">${fmtInt.format(row.employeeCount)}</td><td class="num">${fmtInt.format(row.target)}</td><td class="num">${fmtInt.format(row.current)}</td><td class="num">${row.previous == null ? '--' : fmtInt.format(row.previous)}</td><td class="num ${addedClass}">${added}</td><td class="num ${row.growth > 0 ? 'delta-up' : row.growth < 0 ? 'delta-down' : 'rate-zero'}">${growth}</td><td class="num">${fmtInt.format(row.achieved)}</td><td class="num ${row.achievementRate >= 0.5 ? 'rate-good' : ''}">${pct(row.achievementRate)}</td></tr>`;
  }).join('');
  document.getElementById('groupSummarySub').textContent = `数据日期 ${dashboardData.dataDate} · ${dashboardData.comparisonDate ? `昨日 ${dashboardData.comparisonDate}` : '暂无昨日基线'} · 目标为组内员工固定目标之和`;
}

function refreshGroupFilter() {
  const select = document.getElementById('groupFilter');
  const groups = [...new Set(dashboardData.employees.filter(row => state.role === 'all' || row.role === state.role).map(row => row.group))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  if (state.group !== 'all' && !groups.includes(state.group)) state.group = 'all';
  select.innerHTML = `<option value="all">全部小组</option>${groups.map(group => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join('')}`;
  select.value = state.group;
}

function filteredRows() {
  const query = state.search.trim().toLowerCase();
  const rows = dashboardData.employees.filter(row => (state.role === 'all' || row.role === state.role) && (state.group === 'all' || row.group === state.group) && (!query || [row.name, row.account, row.id, row.group].some(value => String(value || '').toLowerCase().includes(query))));
  const direction = state.direction === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    const av = a[state.sort] ?? '', bv = b[state.sort] ?? '';
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction || a.id.localeCompare(b.id);
    return String(av).localeCompare(String(bv), 'zh-CN') * direction || a.id.localeCompare(b.id);
  });
}

const numberCell = value => value == null ? '<span class="rank">--</span>' : fmtInt.format(value);
function renderTable() {
  const rows = filteredRows();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const visible = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
  document.getElementById('employeeBody').innerHTML = visible.length ? visible.map(row => {
    const deltaClass = row.added > 0 ? 'delta-up' : row.added < 0 ? 'delta-down' : '';
    const delta = row.added == null ? '<span class="rank">--</span>' : `${row.added > 0 ? '+' : ''}${fmtInt.format(row.added)}`;
    return `<tr style="--role-color:${roleColors[row.role]}"><td><div class="employee"><span class="avatar">${escapeHtml(row.account).slice(-1)}</span><div><b>${escapeHtml(row.account)}</b><span>员工 ID ${escapeHtml(row.id)}</span></div></div></td><td><span class="role-pill">${row.role}</span></td><td>${escapeHtml(row.group)}</td><td class="num">${fmtInt.format(row.target)}</td><td class="num fav-count ${row.favorites === 0 ? 'zero' : ''}">${fmtInt.format(row.favorites)}</td><td class="num">${numberCell(row.previousFavorites)}</td><td class="num ${deltaClass}">${delta}</td><td class="num ${row.gapToTarget ? 'gap' : 'achieved'}">${row.gapToTarget ? fmtInt.format(row.gapToTarget) : '已达标'}</td></tr>`;
  }).join('') : '<tr><td class="empty" colspan="8">没有符合当前条件的员工</td></tr>';
  const achieved = rows.filter(row => row.gapToTarget === 0).length;
  document.getElementById('tableSub').textContent = `${state.role === 'all' ? '全部端口' : state.role} · 按当前收藏数量排序 · ${dashboardData.comparisonDate ? `昨日 ${dashboardData.comparisonDate}` : '暂无昨日基线'}`;
  document.getElementById('resultCount').textContent = `共 ${rows.length} 名员工 · ${achieved} 名达标 · 当前显示 ${visible.length} 名`;
  document.getElementById('pageLabel').textContent = `${state.page} / ${pages}`;
  document.getElementById('prevPage').disabled = state.page <= 1;
  document.getElementById('nextPage').disabled = state.page >= pages;
  document.querySelectorAll('th[data-sort]').forEach(th => { th.textContent = th.textContent.replace(/ [↑↓]$/, '') + (th.dataset.sort === state.sort ? ` ${state.direction === 'asc' ? '↑' : '↓'}` : ''); });
}

function renderAll() {
  renderSummary(); renderKpis(); renderRoleComparison(); renderInsights(); renderDistribution(); renderGroups(); renderGroupSummary();
  document.getElementById('methodNotes').innerHTML = dashboardData.notes.map(row => `<div class="method-item"><b>${escapeHtml(row.item)}</b><span>${escapeHtml(row.description)}</span></div>`).join('');
  refreshGroupFilter(); renderTable();
  if (window.lucide) lucide.createIcons();
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportCsv() {
  const rows = filteredRows();
  const headers = ['员工账号', '端口', '当前小组', '外教收藏目标', '当前外教收藏数量', '昨日外教收藏数量', '新增数量', '离目标差额'];
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = rows.map(row => [row.account, row.role, row.group, row.target, row.favorites, row.previousFavorites, row.added, row.gapToTarget].map(quote).join(','));
  triggerDownload(new Blob(['\ufeff' + [headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' }), `业务收藏外教明细_${state.role}_${dashboardData.dataDate}.csv`);
  toast(`已导出 ${rows.length} 名员工`);
}

function fitText(ctx, value, width) {
  const text = String(value ?? '');
  if (ctx.measureText(text).width <= width) return text;
  let result = text;
  while (result.length && ctx.measureText(`${result}…`).width > width) result = result.slice(0, -1);
  return `${result}…`;
}

function exportImage() {
  const rows = filteredRows();
  if (!rows.length) return toast('当前筛选没有可导出的员工');
  const scale = 1.5, width = 1490, titleHeight = 132, headerHeight = 48, rowHeight = 44, footerHeight = 34;
  const height = titleHeight + headerHeight + rows.length * rowHeight + footerHeight;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
  ctx.fillStyle = '#0a0c0f'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#f3f5f7'; ctx.font = '700 26px "Microsoft YaHei", sans-serif'; ctx.fillText('业务收藏外教明细', 34, 42);
  ctx.fillStyle = '#9aa0aa'; ctx.font = '14px "Microsoft YaHei", sans-serif';
  const scope = [state.role === 'all' ? '全部端口' : state.role, state.group === 'all' ? '全部小组' : state.group, state.search ? `搜索：${state.search}` : ''].filter(Boolean).join(' · ');
  ctx.fillText(`${scope} · 数据日期 ${dashboardData.dataDate} · 共 ${rows.length} 名员工`, 34, 72);
  ctx.fillText(dashboardData.comparisonDate ? `昨日基线 ${dashboardData.comparisonDate}` : '当前为首个目标基线，暂无昨日数据', 34, 98);
  const columns = [
    { label: '员工账号', key: 'account', width: 250, align: 'left' }, { label: '端口', key: 'role', width: 85, align: 'center' },
    { label: '当前小组', key: 'group', width: 245, align: 'left' }, { label: '外教收藏目标', key: 'target', width: 150, align: 'right' },
    { label: '当前外教收藏数量', key: 'favorites', width: 180, align: 'right' }, { label: '昨日外教收藏数量', key: 'previousFavorites', width: 180, align: 'right' },
    { label: '新增数量', key: 'added', width: 130, align: 'right' }, { label: '离目标差额', key: 'gapToTarget', width: 165, align: 'right' },
  ];
  const left = 34, tableWidth = columns.reduce((sum, column) => sum + column.width, 0), top = titleHeight;
  ctx.fillStyle = '#171b21'; ctx.fillRect(left, top, tableWidth, headerHeight);
  ctx.font = '600 13px "Microsoft YaHei", sans-serif'; ctx.fillStyle = '#9aa0aa';
  let x = left;
  const drawCellText = (text, column, cellX, y) => {
    ctx.textAlign = column.align === 'right' ? 'right' : column.align === 'center' ? 'center' : 'left';
    const tx = column.align === 'right' ? cellX + column.width - 12 : column.align === 'center' ? cellX + column.width / 2 : cellX + 12;
    ctx.fillText(fitText(ctx, text, column.width - 24), tx, y);
  };
  for (const column of columns) { drawCellText(column.label, column, x, top + 30); x += column.width; }
  ctx.font = '13px "Microsoft YaHei", sans-serif';
  rows.forEach((row, index) => {
    const y = top + headerHeight + index * rowHeight;
    ctx.fillStyle = index % 2 ? '#111419' : '#0e1115'; ctx.fillRect(left, y, tableWidth, rowHeight);
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.moveTo(left, y + rowHeight); ctx.lineTo(left + tableWidth, y + rowHeight); ctx.stroke();
    x = left;
    for (const column of columns) {
      let value = row[column.key];
      if (column.key === 'previousFavorites') value = value == null ? '--' : fmtInt.format(value);
      else if (column.key === 'added') value = value == null ? '--' : `${value > 0 ? '+' : ''}${fmtInt.format(value)}`;
      else if (column.key === 'gapToTarget') value = value ? fmtInt.format(value) : '已达标';
      else if (typeof value === 'number') value = fmtInt.format(value);
      ctx.fillStyle = column.key === 'added' && row.added > 0 ? '#5fd59d' : column.key === 'gapToTarget' ? (row.gapToTarget ? '#ff7b72' : '#5fd59d') : '#f3f5f7';
      drawCellText(value, column, x, y + 28); x += column.width;
    }
  });
  ctx.fillStyle = '#69717d'; ctx.textAlign = 'left'; ctx.font = '11px "Microsoft YaHei", sans-serif'; ctx.fillText('数据由业务收藏外教分析看板生成', left, height - 12);
  canvas.toBlob(blob => { if (blob) { triggerDownload(blob, `业务收藏外教明细_${state.role}_${dashboardData.dataDate}.png`); toast(`已生成 ${rows.length} 行明细长图`); } else toast('图片生成失败，请重试'); }, 'image/png');
}

function parseCsv(source) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('CSV 存在未闭合的引号');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter(values => values.some(value => String(value).trim()));
}

async function decodeFile(file) {
  const bytes = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\ufeff/, ''); }
  catch (_) { return new TextDecoder('gb18030').decode(bytes).replace(/^\ufeff/, ''); }
}

function localDateString(date = new Date()) {
  const year = date.getFullYear(), month = String(date.getMonth() + 1).padStart(2, '0'), day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validDateString(year, month, day) {
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? localDateString(date) : null;
}

function inferUploadDate(fileName) {
  const name = String(fileName || '').replace(/\.csv$/i, '');
  let match = name.match(/(20\d{2})(\d{2})(\d{2})/);
  if (match) return validDateString(Number(match[1]), Number(match[2]), Number(match[3]));
  match = name.match(/(20\d{2})[._-](\d{1,2})[._-](\d{1,2})/);
  if (match) return validDateString(Number(match[1]), Number(match[2]), Number(match[3]));
  match = name.match(/(?:^|[^\d])(\d{1,2})[._-](\d{1,2})(?:[^\d]|$)/);
  if (match) return validDateString(new Date().getFullYear(), Number(match[1]), Number(match[2]));
  return localDateString();
}

async function analyzeUpload(file, dataDate) {
  if (!/\.csv$/i.test(file.name)) throw new Error('请上传 CSV 格式的原始明细');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(dataDate || '')) throw new Error('请选择有效的数据日期');
  const rows = parseCsv(await decodeFile(file));
  if (rows.length < 2) throw new Error('CSV 没有可统计的数据行');
  const headers = rows[0].map(value => String(value).trim());
  const missing = REQUIRED_HEADERS.filter(header => !headers.includes(header));
  if (missing.length) throw new Error(`缺少字段：${missing.join('、')}`);
  const index = Object.fromEntries(REQUIRED_HEADERS.map(header => [header, headers.indexOf(header)]));
  const roster = new Map(dashboardData.employees.map(row => [row.id, row]));
  const counts = new Map([...roster.keys()].map(id => [id, 0]));
  const accounts = new Map(), pairs = new Set(), unknown = new Set();
  let sourceRows = 0, duplicates = 0;
  for (const values of rows.slice(1)) {
    const teacherId = String(values[index['外教id']] ?? '').trim().replace(/\.0$/, '');
    const employeeId = String(values[index['业务人员id']] ?? '').trim().replace(/\.0$/, '');
    const account = String(values[index['业务人员名称']] ?? '').trim();
    const roleMatch = String(values[index['业务类型（港澳-cc/ss/lp）']] ?? '').toUpperCase().match(/(?:^|[-_\s])(CC|SS|LP)$/);
    if (!teacherId && !employeeId && !account) continue;
    sourceRows += 1;
    if (!teacherId || !employeeId || !account || !roleMatch) throw new Error(`第 ${sourceRows + 1} 行存在空字段或无效端口`);
    const role = roleMatch[1];
    if (!roster.has(employeeId)) { unknown.add(`${account}（${employeeId}）`); continue; }
    if (roster.get(employeeId).role !== role) throw new Error(`${account}（${employeeId}）端口与员工底表不一致`);
    if (accounts.has(employeeId) && accounts.get(employeeId) !== account) throw new Error(`员工ID ${employeeId} 对应了多个员工账号`);
    accounts.set(employeeId, account);
    const pair = `${employeeId}\u0000${teacherId}`;
    if (pairs.has(pair)) { duplicates += 1; continue; }
    pairs.add(pair); counts.set(employeeId, counts.get(employeeId) + 1);
  }
  if (unknown.size) throw new Error(`发现员工底表外账号，请先维护底表：${[...unknown].slice(0, 5).join('、')}${unknown.size > 5 ? ` 等 ${unknown.size} 人` : ''}`);
  const employees = dashboardData.employees.map(row => ({ role: row.role, id: row.id, account: accounts.get(row.id) || row.account, group: row.group, name: row.name || null, target: row.target, favorites: counts.get(row.id) || 0 }));
  return { schemaVersion: 1, dataDate, sourceName: file.name, sourceRows, uniquePairCount: pairs.size, duplicatePairCount: duplicates, employees };
}

function setImportProgress(mode, title, detail) {
  const box = document.getElementById('importProgress'); box.className = `import-progress ${mode || ''}`;
  box.innerHTML = `<b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span>`;
}

function updatePublishButton() { document.getElementById('publishBtn').disabled = state.busy || !state.upload || !document.getElementById('publishKey').value.trim() || !SYNC_ENDPOINT; }
async function handleFile(file, inferDate = true) {
  state.upload = null; updatePublishButton();
  if (!file) return;
  state.uploadFile = file;
  if (inferDate) document.getElementById('uploadDate').value = inferUploadDate(file.name);
  document.getElementById('uploadMeta').textContent = file.name;
  setImportProgress('working', '正在校验', '正在解析原始明细并核对员工底表...');
  try {
    state.upload = await analyzeUpload(file, document.getElementById('uploadDate').value);
    setImportProgress('success', '文件校验通过', `${state.upload.dataDate} · ${fmtInt.format(state.upload.sourceRows)} 行 · 去重后 ${fmtInt.format(state.upload.uniquePairCount)} 条 · 重复 ${fmtInt.format(state.upload.duplicatePairCount)} 条`);
  } catch (error) {
    setImportProgress('error', '文件校验失败', error.message || '请检查原始文件');
  }
  updatePublishButton();
}

async function publishUpload() {
  if (state.busy || !state.upload) return;
  const publishKey = document.getElementById('publishKey').value.trim();
  state.busy = true; updatePublishButton(); setImportProgress('working', '正在发布公共看板', '仅上传员工汇总，不上传外教明细...');
  try {
    const response = await fetch(SYNC_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Favorites-Key': publishKey }, body: JSON.stringify(state.upload) });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || `发布失败（${response.status}）`);
    dashboardData = calculateData(result.data);
    localStorage.setItem(CACHE_KEY, JSON.stringify(result.data));
    renderAll(); setSync('', `公共数据 ${dashboardData.dataDate}`);
    setImportProgress('success', '公共看板已更新', `${dashboardData.dataDate} · 昨日基线 ${dashboardData.comparisonDate || '暂无'} · ${fmtInt.format(dashboardData.overall.totalFavorites)} 条收藏关系`);
    document.getElementById('publishKey').value = '';
  } catch (error) {
    setImportProgress('error', '发布失败', error.message || '请稍后重试');
  } finally { state.busy = false; updatePublishButton(); }
}

async function loadSharedDashboard() {
  if (!SYNC_ENDPOINT) { setSync('error', '公共同步未配置'); return; }
  setSync('loading', '正在读取公共数据');
  try {
    const response = await fetch(SYNC_ENDPOINT, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (response.status === 404) { setSync('', `发布数据 ${dashboardData.dataDate}`); return; }
    if (!response.ok) throw new Error(`读取失败（${response.status}）`);
    const shared = await response.json();
    dashboardData = calculateData(shared); localStorage.setItem(CACHE_KEY, JSON.stringify(shared)); renderAll();
    setSync('', `公共数据 ${dashboardData.dataDate}`);
  } catch (error) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached) { dashboardData = calculateData(cached); renderAll(); setSync('error', `离线缓存 ${dashboardData.dataDate}`); return; }
    } catch (_) { localStorage.removeItem(CACHE_KEY); }
    setSync('error', `已发布数据 ${dashboardData.dataDate}`);
  }
}

function bindEvents() {
  document.getElementById('searchInput').addEventListener('input', event => { state.search = event.target.value; state.page = 1; renderTable(); });
  document.getElementById('roleFilter').addEventListener('change', event => { state.role = event.target.value; state.page = 1; refreshGroupFilter(); renderTable(); });
  document.getElementById('groupFilter').addEventListener('change', event => { state.group = event.target.value; state.page = 1; renderTable(); });
  document.getElementById('pageSize').addEventListener('change', event => { state.pageSize = Number(event.target.value); state.page = 1; renderTable(); });
  document.getElementById('prevPage').addEventListener('click', () => { state.page -= 1; renderTable(); });
  document.getElementById('nextPage').addEventListener('click', () => { state.page += 1; renderTable(); });
  document.getElementById('exportBtn').addEventListener('click', exportCsv);
  document.getElementById('imageBtn').addEventListener('click', exportImage);
  document.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const key = th.dataset.sort; if (state.sort === key) state.direction = state.direction === 'asc' ? 'desc' : 'asc'; else { state.sort = key; state.direction = ['role', 'group'].includes(key) ? 'asc' : 'desc'; } state.page = 1; renderTable(); }));
  const methodDialog = document.getElementById('methodDialog');
  document.getElementById('methodBtn').addEventListener('click', () => methodDialog.showModal());
  document.getElementById('methodClose').addEventListener('click', () => methodDialog.close());
  methodDialog.addEventListener('click', event => { if (event.target === methodDialog) methodDialog.close(); });
  const uploadDialog = document.getElementById('uploadDialog');
  document.getElementById('uploadBtn').addEventListener('click', () => uploadDialog.showModal());
  document.getElementById('uploadClose').addEventListener('click', () => uploadDialog.close());
  document.getElementById('uploadCancel').addEventListener('click', () => uploadDialog.close());
  uploadDialog.addEventListener('click', event => { if (event.target === uploadDialog) uploadDialog.close(); });
  document.getElementById('uploadFile').addEventListener('change', event => handleFile(event.target.files?.[0]));
  document.getElementById('uploadDate').addEventListener('change', () => { if (state.uploadFile) handleFile(state.uploadFile, false); });
  document.getElementById('publishKey').addEventListener('input', updatePublishButton);
  document.getElementById('publishBtn').addEventListener('click', publishUpload);
}

function init() { renderAll(); bindEvents(); loadSharedDashboard(); }
init();
