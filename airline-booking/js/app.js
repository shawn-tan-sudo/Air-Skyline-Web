/**
 * SkyLine 航空客运订票系统 — 前端交互 (v2.0)
 *
 * 主要功能模块:
 *   - 航班总览 + Hero快捷搜索
 *   - 高级搜索 (按航线 + 日期)
 *   - 步骤化订票 + 可视化座位图
 *   - 订单管理 (PNR 查找 / 退票 / 候补查询)
 *   - 航班录入 (含票价和机场代码)
 *   - 实时统计 + Toast 通知
 */

// ======================== 全局实例 ========================

const sys = new AirlineSystem();

// ======================== 选中状态 (用于订票) ========================

let selectedFlight = null;         // 当前选中航班对象
let selectedSeats = [];            // 用户手动选中的座位号
let seatCabinMap = {};             // seatId → cabinClass 快速查表

// ======================== 初始化 ========================

document.addEventListener('DOMContentLoaded', () => {
  if (!sys.load()) sys.initTestData();
  initTabs();
  bindEvents();
  populateAirportLists();
  refreshAll();
  updateStats();
});

// ======================== Tab 切换 ========================

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      switchTab(id);
      if (id === 'tab-overview') refreshOverview();
      if (id === 'tab-search') populateSearchSelects();
      if (id === 'tab-book') { populateFlightSelects(); resetBooking(); }
      if (id === 'tab-manage') populateManageSelects();
    });
  });
}

// ======================== 事件绑定 ========================

function bindEvents() {
  // 快捷搜索
  $('#btn-quick-search').addEventListener('click', doQuickSearch);
  // 高级搜索
  $('#btn-search').addEventListener('click', doSearch);
  // 订票
  $('#btn-select-flight').addEventListener('click', onSelectFlight);
  $('#btn-book').addEventListener('click', doBook);
  // PNR 管理
  $('#btn-pnr-search').addEventListener('click', doPNRLookup);
  $('#btn-pnr-refund').addEventListener('click', doPNRRefund);
  // 退票
  $('#btn-refund').addEventListener('click', doRefund);
  $('#refund-flight').addEventListener('change', updateRefundCustomers);
  // 候补查看
  $('#btn-waitlist-view').addEventListener('click', doViewWaitlist);
  // 录入
  $('#btn-add-flight').addEventListener('click', doAddFlight);
  // 重置
  $('#btn-reset').addEventListener('click', resetAll);

  // 舱位切换 → 仅刷新价格 (座位选择优先, 不清空)
  const cabinSelect = $('#book-cabin');
  if (cabinSelect) cabinSelect.addEventListener('change', () => renderPassengerForms());
  // 订票数量变化 → 仅刷新价格 (右驱左, 不裁剪座位)
  const countInput = $('#book-count');
  if (countInput) countInput.addEventListener('input', () => renderPassengerForms());
  // 旅客类型变化 → 刷新价格
  const paxTypeSelect = $('#book-passenger-type');
  if (paxTypeSelect) paxTypeSelect.addEventListener('change', updatePriceDisplay);
  // 多乘客表单类型变化 (事件委托)
  const multiList = document.getElementById('multi-pax-list');
  if (multiList) {
    multiList.addEventListener('change', e => {
      if (e.target.classList.contains('pax-type')) updatePriceDisplay();
    });
  }
  // 回车快捷搜索
  document.querySelectorAll('.hero-search input').forEach(el =>
    el.addEventListener('keydown', e => { if (e.key === 'Enter') doQuickSearch(); }));
}

// ======================== 机场列表 ========================

function populateAirportLists() {
  const { origins, dests } = sys.getAirports();
  const datalist = $('#airport-list');
  const all = [...new Set([...origins, ...dests])];
  datalist.innerHTML = all.map(a => `<option value="${a.split(' (')[0]}">`).join('');
}

function populateSearchSelects() {
  const { origins, dests } = sys.getAirports();
  const html = arr => ['<option value="">全部</option>', ...arr.map(a => `<option>${a}</option>`)].join('');
  const selO = $('#search-origin'), selD = $('#search-dest');
  if (selO) selO.innerHTML = html(origins);
  if (selD) selD.innerHTML = html(dests);
}

function populateFlightSelects() {
  const sel = $('#book-flight');
  if (!sel) return;
  sel.innerHTML = sys.flights.map(f =>
    `<option value="${esc(f.flightNo)}">${esc(f.flightNo)} — ${esc(f.origin)}→${esc(f.destination)} (${esc(f.weekday)}) 余${f.remaining}</option>`
  ).join('');
}

function populateManageSelects() {
  const rSel = $('#refund-flight'), wSel = $('#waitlist-flight');
  const html = sys.flights.map(f =>
    `<option value="${esc(f.flightNo)}">${esc(f.flightNo)} — ${esc(f.origin)}→${esc(f.destination)}</option>`
  ).join('');
  if (rSel) rSel.innerHTML = html;
  if (wSel) wSel.innerHTML = html;
  updateRefundCustomers();
}

function updateRefundCustomers() {
  const f = sys.findFlight($('#refund-flight').value);
  const sel = $('#refund-name');
  if (!sel) return;
  if (!f || !f.bookedList.size) { sel.innerHTML = '<option value="">— 无订票记录 —</option>'; return; }
  sel.innerHTML = f.bookedList.toArray().map(c =>
    `<option value="${esc(c.name)}">${esc(c.name)} — ${c.ticketCount}张 (PNR: ${c.pnr})</option>`
  ).join('');
}

// ======================== 统计 ========================

function updateStats() {
  const s = sys.stats();
  $('#hdr-flights').textContent = s.flightCount;
  $('#hdr-remaining').textContent = s.totalRemaining;
  $('#hdr-wait').textContent = s.totalWait;
}

function refreshAll() { refreshOverview(); populateFlightSelects(); populateManageSelects(); updateStats(); }

// ======================== 航班总览 ========================

function refreshOverview() {
  const tbody = $('#overview-tbody');
  if (!sys.flights.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="icon">✈</div>暂无航班，请录入航班数据</div></td></tr>';
    return;
  }
  tbody.innerHTML = sys.flights.map((f, i) => {
    const status = f.isFull
      ? '<span class="badge badge-danger">满员</span>'
      : f.remaining < 10
        ? '<span class="badge badge-warning">仅剩' + f.remaining + '座</span>'
        : '<span class="badge badge-success">有票</span>';
    const wb = f.waitQueue.size ? ` <span class="badge badge-info">候${f.waitQueue.size}</span>` : '';
    return `
      <tr class="clickable" data-idx="${i}">
        <td><strong>${esc(f.flightNo)}</strong></td>
        <td>${esc(f.origin)} → ${esc(f.destination)}</td>
        <td>${esc(f.planeNo)}</td><td>${esc(f.weekday)}</td>
        <td>${f.departureTime}–${f.arrivalTime}</td>
        <td>${f.capacity}</td>
        <td><strong>${f.remaining}</strong></td>
        <td>${status}${wb}</td>
        <td><button class="btn btn-outline btn-sm btn-detail" data-idx="${i}">详情</button></td>
      </tr>
      <tr class="expand-row" id="expand-${i}" style="display:none">
        <td colspan="9">
          <div class="expand-inner">
            <div>
              <h4>📋 已订票客户 (按姓名排序链表 · ${f.bookedList.size}人)</h4>
              ${renderBookedSubTable(f)}
            </div>
            <div>
              <h4>⏳ 候补队列 (链式队列 · ${f.waitQueue.size}人)</h4>
              ${renderWaitSubTable(f)}
            </div>
          </div>
        </td>
      </tr>`;
  }).join('');

  // 展开/收起
  tbody.querySelectorAll('tr.clickable').forEach(row => {
    row.addEventListener('click', function (e) {
      if (e.target.closest('button')) return;
      toggleExpand(this.dataset.idx);
    });
  });
  tbody.querySelectorAll('.btn-detail').forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleExpand(this.dataset.idx);
    });
  });
}

function toggleExpand(idx) {
  const el = document.getElementById(`expand-${idx}`);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

function renderBookedSubTable(f) {
  const arr = f.bookedList.toArray();
  if (!arr.length) return '<p class="sub-table-empty">暂无已订票客户</p>';
  return `<div class="table-wrap"><table class="sub-table">
    <thead><tr><th>姓名</th><th>票数</th><th>舱位</th><th>座位</th><th>PNR</th><th>类型</th></tr></thead>
    <tbody>${arr.map(c => `
      <tr><td>${esc(c.name)}</td><td>${c.ticketCount}</td>
      <td>${cabinName(c.cabinClass)}</td><td>${(c.seatNumbers||[]).join(',')}</td>
      <td><code>${c.pnr}</code></td><td>${passengerTypeName(c.passengerType)}</td></tr>
    `).join('')}</tbody>
  </table></div>`;
}

function renderWaitSubTable(f) {
  const arr = f.waitQueue.toArray();
  if (!arr.length) return '<p class="sub-table-empty">暂无候补客户</p>';
  return `<div class="table-wrap"><table class="sub-table">
    <thead><tr><th>序号</th><th>姓名</th><th>需票</th><th>舱位偏好</th><th>联系方式</th><th>登记时间</th></tr></thead>
    <tbody>${arr.map(w => `
      <tr><td>${w.position}</td><td>${esc(w.name)}</td><td>${w.ticketCount}</td>
      <td>${cabinName(w.cabinClass)}</td><td>${esc(w.contact||'—')}</td>
      <td>${w.enqueueTime||'—'}</td></tr>
    `).join('')}</tbody>
  </table></div>`;
}

// ======================== 快捷搜索 (Hero) ========================

function doQuickSearch() {
  const origin = $('#quick-origin').value.trim();
  const dest = $('#quick-dest').value.trim();
  const date = $('#quick-date').value;
  const resultDiv = $('#quick-result');

  if (!origin && !dest) { toast('请输入出发城市或到达城市', 'warning'); return; }

  const results = sys.searchFlights(origin, dest, date);
  if (!results.length) {
    resultDiv.className = 'result-box error show';
    resultDiv.innerHTML = `未找到匹配航线`;
    return;
  }
  resultDiv.className = 'result-box success show';
  resultDiv.innerHTML = renderSearchResults(results);
  bindResultActions(results);
}

// ======================== 高级搜索 ========================

function doSearch() {
  const origin = ($('#search-origin').value || '').replace(/\s*\(.*\)\s*/, '');
  const dest = ($('#search-dest').value || '').replace(/\s*\(.*\)\s*/, '');
  const date = $('#search-date').value;
  const resultDiv = $('#search-result');

  if (!origin && !dest) { toast('请选择出发或到达城市', 'warning'); return; }
  const results = sys.searchFlights(origin, dest, date);
  if (!results.length) {
    resultDiv.className = 'result-box error show';
    resultDiv.innerHTML = '未找到匹配航线';
    return;
  }
  resultDiv.className = 'result-box success show';
  resultDiv.innerHTML = renderSearchResults(results);
  bindResultActions(results);
}

let _lastSearchResults = [];

function renderSearchTableRows(results) {
  return results.map(r => `
    <tr>
      <td><strong>${esc(r.flightNo)}</strong></td>
      <td>${esc(r.origin)} → ${esc(r.destination)}</td>
      <td>${r.nearestDate} (${esc(r.weekday)})</td>
      <td>${r.departureTime}–${r.arrivalTime}</td>
      <td>${esc(r.planeNo)}</td>
      <td class="price-highlight"><span class="currency">¥</span>${r.prices[1]}</td>
      <td class="price-highlight"><span class="currency">¥</span>${r.prices[2]}</td>
      <td class="price-highlight"><span class="currency">¥</span>${r.prices[3]}</td>
      <td>${r.isFull ? '<span class="badge badge-danger">满员</span>' : '<strong>'+r.remaining+'</strong> / '+r.capacity}</td>
      <td>${r.isFull
        ? '<button class="btn btn-outline btn-sm btn-waitlist-action" data-flight="'+esc(r.flightNo)+'">候补</button>'
        : '<button class="btn btn-primary btn-sm btn-book-action" data-flight="'+esc(r.flightNo)+'">预订</button>'}
      </td>
    </tr>`).join('');
}

function sortResults(criterion) {
  if (!_lastSearchResults.length) return;
  const sorted = [..._lastSearchResults];
  switch (criterion) {
    case 'price1-asc':  sorted.sort((a, b) => a.prices[1] - b.prices[1]); break;
    case 'price1-desc': sorted.sort((a, b) => b.prices[1] - a.prices[1]); break;
    case 'price2-asc':  sorted.sort((a, b) => a.prices[2] - b.prices[2]); break;
    case 'price2-desc': sorted.sort((a, b) => b.prices[2] - a.prices[2]); break;
    case 'price3-asc':  sorted.sort((a, b) => a.prices[3] - b.prices[3]); break;
    case 'price3-desc': sorted.sort((a, b) => b.prices[3] - a.prices[3]); break;
    case 'time-asc':    sorted.sort((a, b) => a.departureTime.localeCompare(b.departureTime)); break;
    case 'time-desc':   sorted.sort((a, b) => b.departureTime.localeCompare(a.departureTime)); break;
    default: break;
  }
  const tbody = document.querySelector('#search-result tbody') || document.querySelector('#quick-result tbody');
  if (tbody) tbody.innerHTML = renderSearchTableRows(sorted);
}

function renderSearchResults(results) {
  _lastSearchResults = results;
  return `
    <div class="search-sort-bar">
      <label>排序:</label>
      <select id="search-sort-select">
        <option value="default">默认顺序</option>
        <option value="price1-asc">头等舱价格 ↑</option>
        <option value="price1-desc">头等舱价格 ↓</option>
        <option value="price2-asc">商务舱价格 ↑</option>
        <option value="price2-desc">商务舱价格 ↓</option>
        <option value="price3-asc">经济舱价格 ↑</option>
        <option value="price3-desc">经济舱价格 ↓</option>
        <option value="time-asc">起飞时间早→晚</option>
        <option value="time-desc">起飞时间晚→早</option>
      </select>
    </div>
    <p class="search-result-count">找到 <strong>${results.length}</strong> 个航班</p>
    <div class="table-wrap"><table>
      <thead><tr><th>航班号</th><th>航线</th><th>日期</th><th>时刻</th><th>机型</th>
        <th>头等舱</th><th>商务舱</th><th>经济舱</th><th>余票</th><th>操作</th></tr></thead>
      <tbody>${renderSearchTableRows(results)}</tbody>
    </table></div>`;
}

function bindResultActions(results) {
  // 排序下拉
  const sortSelect = $('#search-sort-select');
  if (sortSelect) sortSelect.addEventListener('change', () => sortResults(sortSelect.value));
  // "预订"按钮 → 跳转订票页
  document.querySelectorAll('.btn-book-action').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab('tab-book');
      $('#book-flight').value = btn.dataset.flight;
      onSelectFlight();
    });
  });
  // "候补"按钮
  document.querySelectorAll('.btn-waitlist-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = prompt('请输入您的姓名以加入候补:');
      if (!name) return;
      const count = parseInt(prompt('需要几张票?', '1'));
      if (!count) return;
      const res = sys.joinWaitlist(btn.dataset.flight, name, count, 3, '');
      if (res.success) toast(res.message, 'info');
      else toast(res.message, 'error');
      refreshAll();
    });
  });
}

// ======================== 订票流程 ========================

function resetBooking() {
  selectedFlight = null;
  selectedSeats = [];
  seatCabinMap = {};
  $('#flight-preview').innerHTML = '';
  $('#seat-map-container').innerHTML = '<p class="empty-state">✈ 请先选择航班查看座位图</p>';
  $('#book-result').className = 'result-box';
  $('#book-step2-card').classList.add('step-disabled');
  $('#book-name').value = '';
  $('#book-contact').value = '';
  $('#book-count').value = '1';
  $('#book-cabin').value = '3';
  // 清理价格摘要 & 舱位提示
  const summary = document.getElementById('seat-price-summary');
  if (summary) summary.remove();
  const hint = document.getElementById('cabin-selection-hint');
  if (hint) hint.remove();
  // 重置多乘客表单为单选模式
  const singleForm = document.getElementById('single-pax-form');
  const multiForm  = document.getElementById('multi-pax-form');
  if (singleForm) singleForm.classList.remove('hidden');
  if (multiForm) multiForm.classList.add('hidden');
}

/** 步骤1→2: 选中航班, 展示预览和座位图 */
function onSelectFlight() {
  const flightNo = $('#book-flight').value;
  const f = sys.findFlight(flightNo);
  if (!f) { toast('请选择一个航班', 'warning'); return; }
  selectedFlight = f;
  selectedSeats = [];
  seatCabinMap = {};

  // 航班预览
  const nd = sys._nearestDate(f.weekday);
  $('#flight-preview').innerHTML = `
    <div class="flight-preview-card">
      <div><strong>${esc(f.flightNo)}</strong></div>
      <div>${esc(f.origin)} (${f.originCode}) → ${esc(f.destination)} (${f.destCode})</div>
      <div>📅 ${nd} (${esc(f.weekday)})</div>
      <div>🕐 ${f.departureTime} – ${f.arrivalTime}</div>
      <div>✈ ${esc(f.planeNo)}</div>
      <div>💺 余 <strong>${f.remaining}</strong> / ${f.capacity}</div>
      <div>💰 头等¥${f.prices[1]} | 商务¥${f.prices[2]} | 经济¥${f.prices[3]}</div>
    </div>`;

  // 渲染座位图
  renderSeatMap(f);

  // 解锁步骤2
  $('#book-step2-card').classList.remove('step-disabled');
  renderPassengerForms();
  $('#book-name').focus();
}

/** 座位图渲染 — 液态玻璃机身 + 舱位分区 + 出口门标识 */
function renderSeatMap(f) {
  const map = f.getSeatMap();
  const exitRows = new Set(map.exitRows);
  let html = '<div class="seat-map-wrapper">';
  html += '<div class="fuselage">';

  for (const zone of map.zones) {
    html += '<div class="cabin-zone">';
    // 舱位分区标题
    html += `<div class="cabin-zone-header" style="background:${zone.bg};">
      <span class="zone-dot" style="background:${zone.color};"></span>
      <span class="zone-name">${zone.name}</span>
      <span class="zone-desc">${zone.rows[0].layout} 布局 · ${zone.rows.length} 排</span>
    </div>`;

    for (const row of zone.rows) {
      const isExit = exitRows.has(row.row);
      html += `<div class="seat-row${isExit ? ' exit-row' : ''}">
        <span class="row-num">${row.row}</span>`;

      for (const col of row.cols) {
        // 过道前置 (C列后)
        if (col.letter === 'D') {
          html += '<span class="seat-aisle"></span>';
        }

        if (!col.exists) {
          html += '<span class="seat nonexist"></span>';
        } else if (col.occupied) {
          html += `<span class="seat occupied" title="${col.id} (已占用)">
            <span class="seat-tip">${col.id} 已占用</span>✕</span>`;
        } else {
          const zonePrice = f.getPrice(zone.cabinClass);
          const fIcons = [], fLabels = [];
          if (col.features && col.features.includes('window')) { fIcons.push('<span class="seat-feature feat-window"></span>'); fLabels.push('靠窗'); }
          if (col.features && col.features.includes('aisle')) { fIcons.push('<span class="seat-feature feat-aisle"></span>'); fLabels.push('过道'); }
          if (col.features && col.features.includes('extra_legroom')) { fIcons.push('<span class="seat-feature feat-legroom"></span>'); fLabels.push('额外空间'); }
          const featSuffix = fLabels.length ? ` · ${fLabels.join(' · ')}` : '';
          html += `<span class="seat available seat-click cabin-${zone.className}" data-seat="${col.id}" data-cabin="${zone.cabinClass}" title="${col.id} · ${zone.name} · ¥${zonePrice.toLocaleString()}${featSuffix}">
            <span class="seat-tip">${col.id} · ${zone.name} · ¥${zonePrice.toLocaleString()}${featSuffix}</span>
            ${fIcons.join('')}${col.id}</span>`;
        }

        // 过道后置 (C列后)
        if (col.letter === 'C') {
          html += '<span class="seat-aisle"></span>';
        }
      }
      html += `<span class="row-num">${row.row}</span></div>`;
    }
    html += '</div>';
  }

  // 机尾 — 机型标识
  html += '<div class="tail-section">';
  html += '<span class="tail-separator"></span>';
  html += `<span class="tail-indicator">${esc(f.planeNo)}</span>`;
  html += '<span class="tail-separator"></span>';
  html += '</div>';

  html += '</div>'; // .fuselage
  html += '</div>'; // .seat-map-wrapper

  $('#seat-map-container').innerHTML = html;

  // 构建 seatId → cabinClass 查表
  seatCabinMap = {};
  document.querySelectorAll('#seat-map-container .seat-click').forEach(el => {
    seatCabinMap[el.dataset.seat] = parseInt(el.dataset.cabin);
  });

  // 绑定座位点击事件 — 右驱左: 直接多选, 跨舱位, 数量自动跟随
  document.querySelectorAll('#seat-map-container .seat-click').forEach(el => {
    el.addEventListener('click', function () {
      const seatId = this.dataset.seat;

      if (this.classList.contains('selected')) {
        // 取消选中
        this.classList.remove('selected');
        selectedSeats = selectedSeats.filter(s => s !== seatId);
      } else {
        // 选中 — 无上限, 不限舱位
        this.classList.add('selected');
        selectedSeats.push(seatId);
      }

      // 订票数量自动跟随已选座位数
      const cntInput = $('#book-count');
      if (cntInput) cntInput.value = selectedSeats.length || 1;
      renderPassengerForms();
    });
  });
}

/** 根据已选座位动态渲染旅客表单 (单选/多选模式切换) */
function renderPassengerForms() {
  const singleForm = document.getElementById('single-pax-form');
  const multiForm  = document.getElementById('multi-pax-form');
  const multiList  = document.getElementById('multi-pax-list');
  const cabinSum   = document.getElementById('multi-pax-cabin-summary');
  if (!singleForm || !multiForm) return;

  if (selectedSeats.length === 0) {
    // 单选模式
    singleForm.classList.remove('hidden');
    multiForm.classList.add('hidden');
    const cnt = $('#book-count');
    if (cnt) cnt.value = 1;
    updatePriceDisplay();
    syncFormIndicators();
    return;
  }

  // 多选模式: 逐座填写旅客信息
  singleForm.classList.add('hidden');
  multiForm.classList.remove('hidden');

  // 舱位汇总
  const tally = {};
  for (const s of selectedSeats) { const c = seatCabinMap[s] || 3; tally[c] = (tally[c] || 0) + 1; }
  const parts = [];
  if (tally[1]) parts.push(`头等舱 ×${tally[1]}`);
  if (tally[2]) parts.push(`商务舱 ×${tally[2]}`);
  if (tally[3]) parts.push(`经济舱 ×${tally[3]}`);
  cabinSum.innerHTML = `📋 已选 <strong>${selectedSeats.length}</strong> 座: ${parts.join(' + ')} — 请为每位旅客填写信息`;

  // 逐座输入行
  multiList.innerHTML = selectedSeats.map(seatId => {
    const cabin = seatCabinMap[seatId] || 3;
    const cn = {1:'头等舱',2:'商务舱',3:'经济舱'}[cabin];
    const css = {1:'cabin-first',2:'cabin-business',3:'cabin-economy'}[cabin];
    const price = selectedFlight ? selectedFlight.getPrice(cabin).toLocaleString() : '—';
    return `
      <div class="passenger-row">
        <span class="pax-seat-badge ${css}">${seatId}</span>
        <span class="pax-cabin-tag">${cn} ¥${price}</span>
        <input type="text" class="pax-name" placeholder="旅客姓名" data-seat="${seatId}" required>
        <select class="pax-type" data-seat="${seatId}">
          <option value="adult">成人</option>
          <option value="child">儿童 (75%)</option>
          <option value="infant">婴儿 (10%)</option>
        </select>
      </div>`;
  }).join('');

  updatePriceDisplay();
  syncFormIndicators();
}

function updatePriceDisplay() {
  if (!selectedFlight) return;

  // 更新舱位选择框的选项文字(带价格)
  const cabinSelect = $('#book-cabin');
  if (cabinSelect && cabinSelect.options) {
    const labels = ['', '头等舱', '商务舱', '经济舱'];
    for (let i = 1; i <= 3; i++)
      if (cabinSelect.options[i - 1]) cabinSelect.options[i - 1].textContent = `${labels[i]} — ¥${selectedFlight.prices[i].toLocaleString()}`;
  }

  // 旅客类型折扣乘数 — 多选模式逐座计算, 单选模式统一
  let total = 0;
  const cabinCounts = { 1: 0, 2: 0, 3: 0 };

  if (selectedSeats.length > 0) {
    // 多选模式: 每座按其旅客类型独立计价
    const rows = document.querySelectorAll('#multi-pax-list .passenger-row');
    if (rows.length > 0) {
      rows.forEach(row => {
        const nameInput = row.querySelector('.pax-name');
        const typeSelect = row.querySelector('.pax-type');
        const seatId = nameInput ? nameInput.dataset.seat : null;
        const paxType = typeSelect ? typeSelect.value : 'adult';
        const mult = { adult: 1.0, child: 0.75, infant: 0.1 }[paxType] || 1.0;
        const cabin = seatId ? (seatCabinMap[seatId] || 3) : 3;
        total += Math.round(selectedFlight.getPrice(cabin) * mult);
        cabinCounts[cabin] = (cabinCounts[cabin] || 0) + 1;
      });
    } else {
      // 行尚未渲染时的后备
      for (const s of selectedSeats) {
        const c = seatCabinMap[s] || 3;
        total += selectedFlight.getPrice(c);
        cabinCounts[c] = (cabinCounts[c] || 0) + 1;
      }
    }
  } else {
    // 单选模式: 统一舱位 × 数量 × 类型
    const paxType = ($('#book-passenger-type') && $('#book-passenger-type').value) || 'adult';
    const mult = { adult: 1.0, child: 0.75, infant: 0.1 }[paxType] || 1.0;
    const formCabin = parseInt(($('#book-cabin') && $('#book-cabin').value) || 3);
    const formCount = parseInt(($('#book-count') && $('#book-count').value) || 1);
    total = Math.round(selectedFlight.getPrice(formCabin) * formCount * mult);
  }

  // 构建舱位明细
  const parts = [];
  if (cabinCounts[1] > 0) parts.push(`头等×${cabinCounts[1]}`);
  if (cabinCounts[2] > 0) parts.push(`商务×${cabinCounts[2]}`);
  if (cabinCounts[3] > 0) parts.push(`经济×${cabinCounts[3]}`);
  const cabinDetail = parts.length > 0 ? parts.join('+') : cabinName(parseInt(($('#book-cabin') && $('#book-cabin').value) || 3));

  // 在座位图上方显示价格摘要
  let summary = document.getElementById('seat-price-summary');
  if (!summary) {
    summary = document.createElement('div');
    summary.id = 'seat-price-summary';
    summary.className = 'price-summary';
    const container = $('#seat-map-container');
    if (container) container.parentNode.insertBefore(summary, container);
  }
  summary.innerHTML = `💺 已选 <strong>${selectedSeats.length}</strong> 座 &nbsp;|&nbsp;
    ${cabinDetail} &nbsp;|&nbsp;
    <strong>合计 ¥${total.toLocaleString()}</strong>`;
}

/** 将已选座位同步回左侧表单指示器 (不改变用户手动输入的值) */
function syncFormIndicators() {
  const cabinSelect = $('#book-cabin');
  if (!cabinSelect || !selectedFlight) return;

  let hint = document.getElementById('cabin-selection-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'cabin-selection-hint';
    hint.className = 'cabin-hint';
    const legend = $('#seat-map-container + .seat-legend');
    if (legend) legend.parentNode.insertBefore(hint, legend.nextSibling);
  }
  if (selectedSeats.length > 0) {
    const tally = {};
    for (const s of selectedSeats) { const c = seatCabinMap[s] || 3; tally[c] = (tally[c] || 0) + 1; }
    const parts = [];
    if (tally[1]) parts.push(`头等×${tally[1]}`);
    if (tally[2]) parts.push(`商务×${tally[2]}`);
    if (tally[3]) parts.push(`经济×${tally[3]}`);
    hint.innerHTML = `已选 <strong>${selectedSeats.length}</strong> 座: ${parts.join(' + ')}`;
    hint.classList.add('locked');
  } else {
    hint.innerHTML = '点击座位直接选择，支持跨舱位多选';
    hint.classList.remove('locked');
  }
}

/** 步骤2→3: 确认订票 (支持多乘客逐座预订) */
function doBook() {
  if (!selectedFlight) { toast('请先选择航班', 'warning'); return; }
  const contact = ($('#book-contact') && $('#book-contact').value || '').trim();

  // ====== 多选模式: 逐座逐旅客订票 ======
  if (selectedSeats.length > 0) {
    const rows = document.querySelectorAll('#multi-pax-list .passenger-row');
    const passengers = [];

    for (const row of rows) {
      const nameInput = row.querySelector('.pax-name');
      const typeSelect = row.querySelector('.pax-type');
      const name = (nameInput && nameInput.value || '').trim();
      const paxType = typeSelect ? typeSelect.value : 'adult';
      const seatId = nameInput ? nameInput.dataset.seat : '';

      if (!name) {
        toast(`请为座位 ${seatId} 填写旅客姓名`, 'warning');
        if (nameInput) nameInput.focus();
        return;
      }
      // 同批次内禁止同名
      if (passengers.some(p => p.name === name)) {
        toast(`旅客 "${name}" 重复，请使用不同的姓名`, 'warning');
        if (nameInput) nameInput.focus();
        return;
      }
      passengers.push({ name, paxType, seatId, cabin: seatCabinMap[seatId] || 3 });
    }

    // 逐人预订 (每人1座1票)
    const results = [];
    for (const p of passengers) {
      const res = sys.bookTicket(
        selectedFlight.flightNo, p.name, 1, p.cabin, p.paxType, contact,
        [p.seatId], { [p.seatId]: p.cabin }
      );
      if (!res.success) {
        toast(res.message, 'error');
        // 部分成功时显示已完成的结果
        if (results.length > 0) showMultiBookingResult(results);
        return;
      }
      results.push(res);
    }

    showMultiBookingResult(results);
    toast(`预订成功! ${results.length} 位旅客`, 'success');
    resetBooking();
    refreshAll();
    return;
  }

  // ====== 单选模式: 传统单旅客订票 ======
  const name = ($('#book-name') && $('#book-name').value || '').trim();
  const cabin = parseInt(($('#book-cabin') && $('#book-cabin').value) || 3);
  const paxType = ($('#book-passenger-type') && $('#book-passenger-type').value) || 'adult';
  const count = parseInt(($('#book-count') && $('#book-count').value) || 1);

  if (!name) { toast('请输入旅客姓名', 'warning'); return; }
  if (!count || count <= 0) { toast('请输入有效的订票数量', 'warning'); return; }

  const res = sys.bookTicket(selectedFlight.flightNo, name, count, cabin, paxType, contact);

  const resultDiv = $('#book-result');
  if (res.success) {
    resultDiv.className = 'result-box success show';
    resultDiv.innerHTML = `
      <div style="font-size:16px;font-weight:700;margin-bottom:12px;">✅ 预订成功!</div>
      <div class="pnr-card">
        <div class="pnr-label">订票参考号 / PNR</div>
        <div class="pnr-code">${res.pnr}</div>
        <div class="booking-detail">
          <div class="detail-item"><div class="dl">旅客</div><div class="dv">${esc(name)}</div></div>
          <div class="detail-item"><div class="dl">航班</div><div class="dv">${res.flightNo}</div></div>
          <div class="detail-item"><div class="dl">航线</div><div class="dv">${esc(res.origin)} → ${esc(res.destination)}</div></div>
          <div class="detail-item"><div class="dl">日期</div><div class="dv">${res.nearestDate} (${res.weekday})</div></div>
          <div class="detail-item"><div class="dl">时刻</div><div class="dv">${res.departureTime}</div></div>
          <div class="detail-item"><div class="dl">舱位</div><div class="dv">${res.cabinDetail || res.cabinName}</div></div>
          <div class="detail-item"><div class="dl">座位号</div><div class="dv">${res.seatNumbers.join(', ')}</div></div>
          <div class="detail-item"><div class="dl">票数</div><div class="dv">${res.ticketCount} 张</div></div>
          <div class="detail-item"><div class="dl">总价</div><div class="dv price-large">¥${res.totalPrice.toLocaleString()}</div></div>
          <div class="detail-item"><div class="dl">订票时间</div><div class="dv">${res.bookingTime}</div></div>
        </div>
        <p style="margin-top:14px;font-size:12px;color:var(--text-light);">📌 请妥善保存 PNR 参考号，用于值机、退票或改签</p>
      </div>`;
    toast(`预订成功! PNR: ${res.pnr}`, 'success');
    resetBooking();
    refreshAll();
  } else if (res.canWaitlist) {
    resultDiv.className = 'result-box warning show';
    resultDiv.innerHTML = `
      <p>⚠ ${esc(res.message)}</p>
      <p style="margin-top:10px;">
        <button class="btn btn-warning" id="btn-join-waitlist">📝 加入候补队列</button>
        <button class="btn btn-outline btn-sm" id="btn-cancel-wl" style="margin-left:8px;">取消</button>
      </p>`;
    $('#btn-join-waitlist').addEventListener('click', () => {
      const wr = sys.joinWaitlist(selectedFlight.flightNo, name, count, cabin, contact);
      if (wr.success) {
        resultDiv.className = 'result-box info show';
        resultDiv.innerHTML = `<p>📝 ${esc(wr.message)}</p>`;
        toast(wr.message, 'info');
      } else {
        resultDiv.className = 'result-box error show';
        resultDiv.innerHTML = `<p>${esc(wr.message)}</p>`;
        toast(wr.message, 'error');
      }
      refreshAll();
    });
    $('#btn-cancel-wl').addEventListener('click', () => {
      resultDiv.className = 'result-box';
    });
  } else {
    resultDiv.className = 'result-box error show';
    resultDiv.innerHTML = `<p>❌ ${esc(res.message)}</p>`;
    toast(res.message, 'error');
  }
}

/** 多旅客预订结果展示 */
function showMultiBookingResult(results) {
  const resultDiv = $('#book-result');
  const totalPrice = results.reduce((sum, r) => sum + r.totalPrice, 0);
  resultDiv.className = 'result-box success show';
  resultDiv.innerHTML = `
    <div style="font-size:16px;font-weight:700;margin-bottom:16px;">✅ 预订成功! 共 ${results.length} 位旅客</div>
    ${results.map(r => `
    <div class="pnr-card" style="margin-bottom:10px;text-align:left;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div>
          <div class="pnr-label" style="margin-bottom:2px;">PNR 参考号</div>
          <div class="pnr-code" style="font-size:20px;">${r.pnr}</div>
        </div>
        <div style="text-align:right;">
          <span class="badge badge-gold">${r.cabinDetail || r.cabinName}</span>
          <span class="badge" style="background:#e8f0fe;color:#1a56db;">${passengerTypeName(r.passengerType)}</span>
        </div>
      </div>
      <div style="font-size:13px;color:var(--text-mid);margin-top:8px;display:flex;gap:16px;flex-wrap:wrap;">
        <span>🧑 ${esc(r.name || '—')}</span>
        <span>💺 ${r.seatNumbers.join(', ')}</span>
        <span>🕐 ${r.bookingTime}</span>
        <span style="font-weight:700;color:var(--text);">¥${r.totalPrice.toLocaleString()}</span>
      </div>
    </div>`).join('')}
    <div style="text-align:center;font-weight:700;font-size:16px;padding:8px;color:var(--primary);">
      合计: ¥${totalPrice.toLocaleString()}
    </div>
    <p style="margin-top:12px;font-size:12px;color:var(--text-light);text-align:center;">📌 请妥善保存每位旅客的 PNR 参考号，用于值机、退票或改签</p>`;
}

// ======================== PNR 管理 ========================

let currentPNR = null;

function doPNRLookup() {
  const pnr = $('#pnr-lookup').value.trim().toUpperCase();
  const resultDiv = $('#pnr-result');
  if (!pnr) { toast('请输入 PNR 参考号', 'warning'); return; }

  const info = sys.lookupByPNR(pnr);
  if (!info.found) {
    resultDiv.className = 'result-box error show';
    resultDiv.innerHTML = `<p>❌ 未找到 PNR <strong>${esc(pnr)}</strong> 对应的订票记录</p>`;
    $('#btn-pnr-refund').style.display = 'none';
    currentPNR = null;
    return;
  }

  currentPNR = pnr;
  resultDiv.className = 'result-box success show';
  resultDiv.innerHTML = `
    <p style="font-weight:700;margin-bottom:12px;">✅ 找到订票记录</p>
    <div class="pnr-card">
      <div class="pnr-code" style="font-size:28px;">${info.pnr}</div>
      <div class="booking-detail">
        <div class="detail-item"><div class="dl">旅客</div><div class="dv">${esc(info.name)}</div></div>
        <div class="detail-item"><div class="dl">航班</div><div class="dv">${info.flightNo}</div></div>
        <div class="detail-item"><div class="dl">航线</div><div class="dv">${esc(info.origin)} → ${esc(info.destination)}</div></div>
        <div class="detail-item"><div class="dl">日期</div><div class="dv">${info.weekday} ${info.departureTime}</div></div>
        <div class="detail-item"><div class="dl">舱位</div><div class="dv">${info.cabinName}</div></div>
        <div class="detail-item"><div class="dl">旅客类型</div><div class="dv">${passengerTypeName(info.passengerType)}${info.passengerType !== 'adult' ? ' <em style="font-size:11px;color:var(--text-light);">(折扣价)</em>' : ''}</div></div>
        <div class="detail-item"><div class="dl">座位</div><div class="dv">${(info.seatNumbers||[]).join(', ')}</div></div>
        <div class="detail-item"><div class="dl">票数</div><div class="dv">${info.ticketCount} 张</div></div>
        <div class="detail-item"><div class="dl">票价</div><div class="dv">¥${info.price.toLocaleString()}</div></div>
        <div class="detail-item"><div class="dl">订票时间</div><div class="dv">${info.bookingTime}</div></div>
      </div>
    </div>`;
  $('#btn-pnr-refund').style.display = 'inline-flex';
}

function doPNRRefund() {
  if (!currentPNR) return;
  if (!confirm(`确认使用 PNR ${currentPNR} 办理退票? 退票后该订票记录将作废。`)) return;

  const res = sys.refundByPNR(currentPNR);
  const resultDiv = $('#pnr-result');
  if (res.success) {
    let html = `<p>✅ ${esc(res.message)}</p>`;
    if (res.fulfilled && res.fulfilled.length > 0) {
      html += `<p style="margin-top:8px;">🔄 候补队列自动处理:</p><ul>`;
      for (const ff of res.fulfilled)
        html += `<li>${esc(ff.name)} → 候补成功 ${ff.ticketCount}张 (PNR: ${ff.pnr})</li>`;
      html += '</ul>';
    }
    resultDiv.className = 'result-box success show';
    resultDiv.innerHTML = html;
    toast(res.message, 'success');
    $('#btn-pnr-refund').style.display = 'none';
    currentPNR = null;
    refreshAll();
  } else {
    toast(res.message, 'error');
  }
}

// ======================== 按姓名退票 ========================

function doRefund() {
  const flightNo = $('#refund-flight').value;
  const name = $('#refund-name').value;
  const resultDiv = $('#refund-result');
  if (!name) { toast('请选择客户姓名', 'warning'); return; }
  if (!confirm(`确认办理退票?\n航班: ${flightNo}\n旅客: ${name}`)) return;

  const res = sys.refundTicket(flightNo, name);
  if (res.success) {
    let html = `<p>✅ ${esc(res.message)}</p>`;
    if (res.fulfilled && res.fulfilled.length > 0) {
      html += `<p style="margin-top:8px;">🔄 候补队列自动补位:</p><ul>`;
      for (const ff of res.fulfilled)
        html += `<li>${esc(ff.name)} → ${ff.ticketCount}张 (PNR: ${ff.pnr})</li>`;
      html += '</ul>';
      toast(`已自动为 ${res.fulfilled.length} 位候补客户办理订票`, 'info');
    }
    resultDiv.className = 'result-box success show';
    resultDiv.innerHTML = html;
    toast(res.message, 'success');
    refreshAll();
  } else {
    resultDiv.className = 'result-box error show';
    resultDiv.innerHTML = `<p>❌ ${esc(res.message)}</p>`;
    toast(res.message, 'error');
  }
}

// ======================== 候补查询 ========================

function doViewWaitlist() {
  const flightNo = $('#waitlist-flight').value;
  const f = sys.findFlight(flightNo);
  const resultDiv = $('#waitlist-result');
  if (!f) { toast('请选择航班', 'warning'); return; }

  const arr = f.waitQueue.toArray();
  if (!arr.length) {
    resultDiv.className = 'result-box info show';
    resultDiv.innerHTML = '<p>此航班当前无候补客户</p>';
    return;
  }
  resultDiv.className = 'result-box info show';
  resultDiv.innerHTML = `
    <p style="font-weight:600;margin-bottom:10px;">📋 ${esc(f.flightNo)} 候补队列 (共${f.waitQueue.size}人, 队头优先)</p>
    <div class="table-wrap"><table>
      <thead><tr><th>序号</th><th>姓名</th><th>需票</th><th>舱位</th><th>联系方式</th><th>登记时间</th></tr></thead>
      <tbody>${arr.map(w => `
        <tr><td>${w.position}</td><td>${esc(w.name)}</td><td>${w.ticketCount}</td>
        <td>${cabinName(w.cabinClass)}</td><td>${esc(w.contact||'—')}</td>
        <td>${w.enqueueTime||'—'}</td></tr>
      `).join('')}</tbody>
    </table></div>`;
}

// ======================== 录入航班 ========================

function doAddFlight() {
  const origin = $('#add-origin').value.trim();
  const originCode = $('#add-origin-code').value.trim().toUpperCase();
  const dest = $('#add-dest').value.trim();
  const destCode = $('#add-dest-code').value.trim().toUpperCase();
  const flightNo = $('#add-flightno').value.trim();
  const planeNo = $('#add-planeno').value.trim();
  const weekday = $('#add-weekday').value;
  const depTime = $('#add-deptime').value;
  const arrTime = $('#add-arrtime').value;
  const capacity = parseInt($('#add-capacity').value);
  const prices = {
    1: parseInt($('#add-price1').value) || 4500,
    2: parseInt($('#add-price2').value) || 2200,
    3: parseInt($('#add-price3').value) || 700,
  };

  if (!origin || !dest || !flightNo || !planeNo) {
    toast('请填写始发站、终点站、航班号、飞机号', 'warning'); return;
  }
  if (!capacity || capacity <= 0) { toast('请输入有效的乘员定额', 'warning'); return; }
  if (sys.findFlight(flightNo)) { toast('航班号已存在!', 'error'); return; }

  sys.addFlight(origin, originCode || origin.slice(0,3).toUpperCase(),
                dest, destCode || dest.slice(0,3).toUpperCase(),
                flightNo, planeNo, weekday, depTime, arrTime, capacity, prices);

  // 清空表单
  ['#add-origin','#add-dest','#add-flightno','#add-planeno','#add-origin-code','#add-dest-code']
    .forEach(s => { const el = $(s); if (el) el.value = ''; });
  $('#add-capacity').value = '200';

  const resultDiv = $('#add-result');
  resultDiv.className = 'result-box success show';
  resultDiv.innerHTML = `<p>✅ 航班 <strong>${esc(flightNo)}</strong> 录入成功!</p>`;
  toast(`航班 ${flightNo} 已录入`, 'success');
  refreshAll();
}

// ======================== 重置 ========================

function resetAll() {
  if (!confirm('确认恢复为测试数据? 当前所有数据将丢失!')) return;
  sys.clearAll();
  localStorage.removeItem('airline_v2_data');
  sys.initTestData();
  resetBooking();
  refreshAll();
  toast('数据已重置为测试数据', 'info');
}

// ======================== Toast ========================

function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3000);
  setTimeout(() => el.remove(), 3400);
}

// ======================== 工具函数 ========================

function $(sel) { return document.querySelector(sel); }
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function passengerTypeName(t) { return {adult:'成人',child:'儿童',infant:'婴儿'}[t] || t; }
function deactivateAllTabs() {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
}

function switchTab(tabId) {
  deactivateAllTabs();
  const btn = $(`[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');
  const content = document.getElementById(tabId);
  if (content) content.classList.add('active');
}
