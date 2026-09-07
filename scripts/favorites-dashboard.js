const fmtInt = new Intl.NumberFormat('zh-CN');
const fmt1 = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const roleColors = { CC: 'var(--cyan)', SS: 'var(--coral)', LP: 'var(--green)' };
const state = { search: '', role: 'all', group: 'all', sort: 'favorites', direction: 'desc', page: 1, pageSize: 25 };

function roleSummary(role) { return DATA.roles.find(row => row.role === role); }
function multiple(a, b) { return `${(a / b).toFixed(1)} 倍`; }
function toast(message) { const el = document.getElementById('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200); }

function renderSummary() {
  const cc = roleSummary('CC'), ss = roleSummary('SS'), lp = roleSummary('LP');
  document.getElementById('dataDate').textContent = DATA.dataDate;
  document.getElementById('sideDate').textContent = DATA.dataDate;
  document.getElementById('syncTime').textContent = `数据更新 ${DATA.dataDate}`;
  document.getElementById('summaryLpAvg').textContent = fmt1.format(lp.average);
  document.getElementById('summaryLpMultiple').textContent = multiple(lp.average, Math.max(cc.average, ss.average));
  document.getElementById('summaryCcSkew').textContent = multiple(cc.average, cc.median);
  document.getElementById('summarySsSkew').textContent = multiple(ss.average, ss.median);
  document.getElementById('summaryZero').textContent = DATA.overall.zeroEmployeeCount;
  document.getElementById('summaryCcZero').textContent = cc.zeroEmployeeCount;
  document.getElementById('summarySsZero').textContent = ss.zeroEmployeeCount;
}

function renderKpis() {
  const cards = DATA.roles.map(row => ({
    accent: roleColors[row.role], icon: row.role === 'LP' ? 'headphones' : row.role === 'SS' ? 'messages-square' : 'phone-call',
    label: `${row.role} 端口平均收藏`, value: fmt1.format(row.average), unit: '位 / 人',
    meta: `${row.employeeCount} 名员工 · 中位数 <strong>${fmt1.format(row.median)}</strong> · 有收藏率 <strong>${pct(row.activeRate)}</strong>`,
  }));
  cards.push({ accent: 'var(--amber)', icon: 'users-round', label: '全端口收藏覆盖', value: pct(DATA.overall.activeRate), unit: '', meta: `${DATA.overall.activeEmployeeCount} / ${DATA.overall.employeeCount} 名员工有收藏 · 合计 <strong>${fmtInt.format(DATA.overall.totalFavorites)}</strong> 人次` });
  document.getElementById('kpiGrid').innerHTML = cards.map(card => `<article class="kpi-card" style="--accent:${card.accent}"><div class="kpi-top"><span>${card.label}</span><span class="kpi-icon"><i data-lucide="${card.icon}"></i></span></div><div class="kpi-value">${card.value}<span class="kpi-unit">${card.unit}</span></div><div class="kpi-meta">${card.meta}</div></article>`).join('');
}

function renderRoleComparison() {
  const maxAverage = Math.max(...DATA.roles.map(row => row.average));
  const header = `<div class="role-row head"><div>端口</div><div>平均收藏</div><div>中位数</div><div>收藏合计</div><div>员工数</div><div>有收藏率</div></div>`;
  const rows = DATA.roles.map(row => `<div class="role-row" style="--role-color:${roleColors[row.role]}"><div class="role-name">${row.role}</div><div class="average-bar"><div class="track"><span style="width:${row.average / maxAverage * 100}%;--bar:${roleColors[row.role]}"></span></div><strong>${fmt1.format(row.average)}</strong></div><div class="role-stat">${fmt1.format(row.median)}<span>典型水平</span></div><div class="role-stat">${fmtInt.format(row.totalFavorites)}<span>员工去重后合计</span></div><div class="role-stat">${row.employeeCount}<span>${row.zeroEmployeeCount} 人为 0</span></div><div class="role-stat ${row.activeRate === 1 ? 'good' : ''}">${pct(row.activeRate)}<span>${row.activeEmployeeCount} 人有收藏</span></div></div>`).join('');
  document.getElementById('roleComparison').innerHTML = header + rows;
}

function renderInsights() {
  const cc = roleSummary('CC'), ss = roleSummary('SS'), lp = roleSummary('LP');
  const topGroup = DATA.groups[0];
  const insights = [
    { tone: 'var(--green)', tag: '可复制', title: 'LP 可作为收藏运营标杆', body: `LP 人均 ${fmt1.format(lp.average)}、中位数 ${fmt1.format(lp.median)}，${lp.employeeCount} 人全部有收藏；整体分布也比 CC / SS 更均衡。` },
    { tone: 'var(--amber)', tag: '需校准', title: 'CC / SS 的平均值高于典型水平', body: `CC 人均是中位数的 ${multiple(cc.average, cc.median)}，SS 为 ${multiple(ss.average, ss.median)}；建议考核同时看中位数与覆盖率。` },
    { tone: 'var(--coral)', tag: '优先行动', title: `先激活 ${DATA.overall.zeroEmployeeCount} 名零收藏员工`, body: `CC 有 ${cc.zeroEmployeeCount} 人、SS 有 ${ss.zeroEmployeeCount} 人未收藏外教；先设置基础收藏清单，比继续推高头部更能改善覆盖。` },
    { tone: 'var(--cyan)', tag: '小组洞察', title: '小组表现需结合样本量判断', body: `${topGroup.group} 当前人均 ${fmt1.format(topGroup.average)}、中位数 ${fmt1.format(topGroup.median)}，共 ${topGroup.employeeCount} 名员工；小样本小组不宜只看平均值。` },
  ];
  document.getElementById('insightList').innerHTML = insights.map(row => `<div class="insight" style="--tone:${row.tone}"><div class="insight-top"><b>${row.title}</b><i>${row.tag}</i></div><p>${row.body}</p></div>`).join('');
}

function renderDistribution() {
  const max = Math.max(...DATA.distribution.map(row => row.total));
  document.getElementById('distribution').innerHTML = DATA.distribution.map(row => {
    const width = row.total / max * 100;
    const cc = row.total ? row.byRole.CC / row.total * width : 0;
    const ss = row.total ? row.byRole.SS / row.total * width : 0;
    const lp = row.total ? row.byRole.LP / row.total * width : 0;
    return `<div class="dist-row"><span class="dist-label">${row.label} 位</span><div class="stack" title="CC ${row.byRole.CC} / SS ${row.byRole.SS} / LP ${row.byRole.LP}"><span style="width:${cc}%;background:var(--cyan)"></span><span style="width:${ss}%;background:var(--coral)"></span><span style="width:${lp}%;background:var(--green)"></span></div><strong class="dist-total">${row.total}</strong></div>`;
  }).join('');
  const below50 = DATA.distribution.filter(row => ['0', '1-9', '10-49'].includes(row.label)).reduce((sum, row) => sum + row.total, 0);
  const above300 = DATA.distribution.filter(row => ['300-999', '1000+'].includes(row.label)).reduce((sum, row) => sum + row.total, 0);
  document.getElementById('distributionNote').textContent = `${below50} 名员工收藏少于 50 位，占全体 ${pct(below50 / DATA.overall.employeeCount)}；收藏 300 位以上的员工共 ${above300} 名。`;
}

function renderGroups() {
  document.getElementById('groupList').innerHTML = DATA.groups.slice(0, 10).map((row, index) => `<div class="group-row" style="--role-color:${roleColors[row.role]}"><span class="group-rank">${String(index + 1).padStart(2, '0')}</span><div class="group-name"><b>${row.role}</b>${row.group}</div><div class="group-stat">${row.employeeCount}<span>员工</span></div><div class="group-stat">${fmt1.format(row.average)}<span>平均</span></div><div class="group-stat">${fmt1.format(row.median)}<span>中位数</span></div></div>`).join('');
}

function refreshGroupFilter() {
  const select = document.getElementById('groupFilter');
  const groups = [...new Set(DATA.employees.filter(row => state.role === 'all' || row.role === state.role).map(row => row.group))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  if (state.group !== 'all' && !groups.includes(state.group)) state.group = 'all';
  select.innerHTML = `<option value="all">全部小组</option>${groups.map(group => `<option value="${group}">${group}</option>`).join('')}`;
  select.value = state.group;
}

function filteredRows() {
  const query = state.search.trim().toLowerCase();
  const rows = DATA.employees.filter(row => (state.role === 'all' || row.role === state.role) && (state.group === 'all' || row.group === state.group) && (!query || [row.name, row.account, row.id, row.group].some(value => String(value).toLowerCase().includes(query))));
  const direction = state.direction === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    const av = a[state.sort] ?? '', bv = b[state.sort] ?? '';
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction || a.id.localeCompare(b.id);
    return String(av).localeCompare(String(bv), 'zh-CN') * direction || a.id.localeCompare(b.id);
  });
}

function renderTable() {
  const rows = filteredRows();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * state.pageSize;
  const visible = rows.slice(start, start + state.pageSize);
  document.getElementById('employeeBody').innerHTML = visible.length ? visible.map(row => { const displayName = row.name || row.account; const subline = row.name ? `${row.account} · ${row.id}` : `员工 ID ${row.id}`; return `<tr style="--role-color:${roleColors[row.role]}"><td class="num rank ${row.overallRank <= 3 ? 'top' : ''}">#${row.overallRank}</td><td><div class="employee"><span class="avatar">${displayName.slice(-1)}</span><div><b>${displayName}</b><span>${subline}</span></div></div></td><td><span class="role-pill">${row.role}</span></td><td>${row.group}</td><td class="num fav-count ${row.favorites === 0 ? 'zero' : ''}">${fmtInt.format(row.favorites)}</td><td class="num">#${row.roleRank}</td></tr>`; }).join('') : `<tr><td class="empty" colspan="6">没有符合当前条件的员工</td></tr>`;
  const activeCount = rows.filter(row => row.favorites > 0).length;
  document.getElementById('tableSub').textContent = `${state.role === 'all' ? '全部端口' : state.role} · 默认按收藏外教数降序`;
  document.getElementById('resultCount').textContent = `共 ${rows.length} 名员工 · ${activeCount} 名有收藏 · 当前显示 ${visible.length} 名`;
  document.getElementById('pageLabel').textContent = `${state.page} / ${pages}`;
  document.getElementById('prevPage').disabled = state.page <= 1;
  document.getElementById('nextPage').disabled = state.page >= pages;
  document.querySelectorAll('th[data-sort]').forEach(th => { th.textContent = th.textContent.replace(/ [↑↓]$/, '') + (th.dataset.sort === state.sort ? ` ${state.direction === 'asc' ? '↑' : '↓'}` : ''); });
}

function exportCsv() {
  const rows = filteredRows();
  const headers = ['总排名','端口排名','端口','员工ID','员工账号','员工姓名','当前小组','本人收藏外教数'];
  const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = rows.map(row => [row.overallRank,row.roleRank,row.role,row.id,row.account,row.name,row.group,row.favorites].map(escape).join(','));
  const blob = new Blob(['\ufeff' + [headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `业务收藏外教排名_${state.role}_${DATA.dataDate}.csv`; link.click(); URL.revokeObjectURL(url);
  toast(`已导出 ${rows.length} 名员工`);
}

function bindEvents() {
  document.getElementById('searchInput').addEventListener('input', event => { state.search = event.target.value; state.page = 1; renderTable(); });
  document.getElementById('roleFilter').addEventListener('change', event => { state.role = event.target.value; state.page = 1; refreshGroupFilter(); renderTable(); });
  document.getElementById('groupFilter').addEventListener('change', event => { state.group = event.target.value; state.page = 1; renderTable(); });
  document.getElementById('pageSize').addEventListener('change', event => { state.pageSize = Number(event.target.value); state.page = 1; renderTable(); });
  document.getElementById('prevPage').addEventListener('click', () => { state.page--; renderTable(); });
  document.getElementById('nextPage').addEventListener('click', () => { state.page++; renderTable(); });
  document.getElementById('exportBtn').addEventListener('click', exportCsv);
  document.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => { const key = th.dataset.sort; if (state.sort === key) state.direction = state.direction === 'asc' ? 'desc' : 'asc'; else { state.sort = key; state.direction = ['role','group'].includes(key) ? 'asc' : 'desc'; } state.page = 1; renderTable(); }));
  const dialog = document.getElementById('methodDialog');
  document.getElementById('methodBtn').addEventListener('click', () => dialog.showModal());
  document.getElementById('methodClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
}

function init() {
  renderSummary(); renderKpis(); renderRoleComparison(); renderInsights(); renderDistribution(); renderGroups();
  document.getElementById('methodNotes').innerHTML = DATA.notes.map(row => `<div class="method-item"><b>${row.item}</b><span>${row.description}</span></div>`).join('');
  refreshGroupFilter(); renderTable(); bindEvents(); lucide.createIcons();
}
init();
