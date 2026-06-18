/**
 * SkyLine 航空客运订票系统 — 前端交互 (v2.3)
 *
 * 主要功能模块:
 *   - 航班总览 + Hero快捷搜索
 *   - 高级搜索 (按航线 + 日期) — 共享 performSearch 逻辑
 *   - 步骤化订票 + 可视化座位图 (seatCabinMap 渲染时构建)
 *   - 订单管理 (PNR 查找 / 退票 / 候补查询)
 *   - 航班录入 (含票价和机场代码)
 *   - 数据导入/导出 (JSON 文件)
 *   - 候补登记模态框 (替代 prompt)
 *   - 实时统计 + Toast 通知 (上限5条)
 */

// ======================== 全局实例 & 状态 ========================

const sys = new AirlineSystem();

const State = {
  selectedFlight: null,         // 当前选中航班对象
  selectedSeats: [],            // 用户手动选中的座位号
  seatCabinMap: {},             // seatId → cabinClass (渲染时同步构建, 不从DOM反查)
  currentPNR: null,             // PNR 管理
  lastSearchResults: [],        // 搜索结果缓存 (排序用)
  pendingWaitlistFlight: null,  // 候补模态框目标航班
  // 搜索筛选状态
  activeTimePeriod: 'all',      // 当前选中的出发时段
  activeAircraftTypes: [],      // 当前选中的机型列表
  searchHistory: [],            // 搜索历史 (最近5条)
};

// ======================== 初始化 ========================

document.addEventListener('DOMContentLoaded', () => {
  if (!sys.load()) sys.initTestData();
  initTabs();
  bindEvents();
  populateAirportLists();
  refreshAll();
  updateStats();
  initBackToTop();
  initSmoothScroll();
  // 初始化 tab 滑动指示器
  setTimeout(updateTabIndicator, 100);
  window.addEventListener('resize', updateTabIndicator);
});

// ======================== 返回顶部按钮 ========================

function initBackToTop() {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;

  const toggle = () => {
    if (window.scrollY > 500) btn.classList.add('visible');
    else btn.classList.remove('visible');
  };

  window.addEventListener('scroll', toggle, { passive: true });
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ======================== 平滑滚动 ========================

function initSmoothScroll() {
  document.documentElement.style.scrollBehavior = 'smooth';
}

// ======================== Tab 滑动指示器 ========================

function updateTabIndicator() {
  const active = document.querySelector('.tab-btn.active');
  const nav = document.querySelector('.tab-nav');
  if (!active || !nav) return;
  const navRect = nav.getBoundingClientRect();
  const btnRect = active.getBoundingClientRect();
  nav.style.setProperty('--indicator-left', (btnRect.left - navRect.left) + 'px');
  nav.style.setProperty('--indicator-width', btnRect.width + 'px');
  // apply via inline style since CSS custom properties are easier
  nav.style.setProperty('--tab-left', (btnRect.left - navRect.left) + 'px');
  nav.style.setProperty('--tab-width', btnRect.width + 'px');
}

// ======================== 自定义确认对话框 ========================

function showConfirm(title, message, icon = '⚠️') {
  return new Promise((resolve) => {
    // 移除旧对话框
    const old = document.querySelector('.confirm-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay show';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <div class="confirm-icon">${icon}</div>
        <div class="confirm-title">${esc(title)}</div>
        <div class="confirm-msg">${esc(message)}</div>
        <div class="confirm-actions">
          <button class="btn btn-outline" id="confirm-cancel">取消</button>
          <button class="btn btn-gold" id="confirm-ok">确认</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = (val) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve(val);
    };

    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    overlay.querySelector('#confirm-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('#confirm-ok').addEventListener('click', () => close(true));
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', escHandler); }
    });
  });
}

function showAlert(title, message, icon = '📋') {
  return new Promise((resolve) => {
    const old = document.querySelector('.confirm-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay show';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <div class="confirm-icon">${icon}</div>
        <div class="confirm-title">${esc(title)}</div>
        <div class="confirm-msg">${esc(message)}</div>
        <div class="confirm-actions">
          <button class="btn btn-primary" id="confirm-ok">确定</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve();
    };

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('#confirm-ok').addEventListener('click', close);
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape' || e.key === 'Enter') { close(); document.removeEventListener('keydown', escHandler); }
    });
  });
}

// ======================== Tab 切换 ========================

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      switchTab(id);
      // 切换到哪个 tab 就刷新对应的数据
      if (id === 'tab-overview') refreshOverview();
      if (id === 'tab-search') populateSearchSelects();
      if (id === 'tab-book') { populateFlightSelects(); resetBooking(); }
      if (id === 'tab-manage') populateManageSelects();
    });
  });
}

// ======================== 事件绑定 ========================

function bindEvents() {
  // 快捷搜索 — 使用共享 performSearch
  $('#btn-quick-search').addEventListener('click', () => {
    performQuickSearch();
  });
  // 高级搜索
  $('#btn-search').addEventListener('click', () => {
    performAdvancedSearch();
  });
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
  // 候补模态框提交
  $('#btn-submit-waitlist').addEventListener('click', submitWaitlist);
  // 录入
  $('#btn-add-flight').addEventListener('click', doAddFlight);
  // 重置
  $('#btn-reset').addEventListener('click', resetAll);
  // 导出
  const btnExport = $('#btn-export');
  if (btnExport) btnExport.addEventListener('click', exportData);
  // 导入
  const btnImport = $('#btn-import');
  if (btnImport) btnImport.addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });

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
  // 回车快捷搜索 (在 hero 区域输入框)
  document.querySelectorAll('.hero-search input').forEach(el =>
    el.addEventListener('keydown', e => { if (e.key === 'Enter') {
      const inSearchTab = el.closest('#tab-search');
      if (inSearchTab) performAdvancedSearch();
      else performQuickSearch();
    }}));
  // 高级筛选面板切换
  const toggleBtn = $('#btn-toggle-filters');
  if (toggleBtn) toggleBtn.addEventListener('click', toggleFilterPanel);
  // 时段筛选 chips
  initChipGroup('time-period-chips', (value) => {
    State.activeTimePeriod = value;
  });
  // 机型 chips (动态填充, 需在 populateAircraftChips 之后绑定)
  // 事件委托在 chip-group 上
  const aircraftChips = $('#aircraft-chips');
  if (aircraftChips) {
    aircraftChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const acType = chip.dataset.type;
      if (chip.classList.contains('active')) {
        chip.classList.remove('active');
        State.activeAircraftTypes = State.activeAircraftTypes.filter(t => t !== acType);
      } else {
        if (State.activeAircraftTypes.length >= 3) {
          toast('最多选择3种机型', 'warning');
          return;
        }
        chip.classList.add('active');
        State.activeAircraftTypes.push(acType);
      }
    });
  }
  // 价格舱位切换 → 更新快捷价格按钮
  const priceCabin = $('#filter-price-cabin');
  if (priceCabin) priceCabin.addEventListener('change', updateQuickPriceChips);
  // 清除价格
  const clearPriceBtn = $('#btn-clear-price');
  if (clearPriceBtn) clearPriceBtn.addEventListener('click', () => {
    const minEl = $('#filter-min-price'), maxEl = $('#filter-max-price');
    if (minEl) minEl.value = '';
    if (maxEl) maxEl.value = '';
  });
  // 重置筛选
  const resetFiltersBtn = $('#btn-reset-filters');
  if (resetFiltersBtn) resetFiltersBtn.addEventListener('click', resetAllFilters);
  // 快捷标签事件委托
  const quickChipsBar = $('#quick-chips-bar');
  if (quickChipsBar) {
    quickChipsBar.addEventListener('click', (e) => {
      const chip = e.target.closest('.quick-chip');
      if (!chip) return;
      applyQuickChip(chip.dataset.action, chip.dataset.value);
    });
  }
  // 候补模态框: 点击遮罩关闭
  const modal = $('#waitlist-modal');
  if (modal) {
    modal.addEventListener('click', e => { if (e.target === modal) closeWaitlistModal(); });
  }
  // ESC 关闭模态框
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeWaitlistModal();
  });
  // 事件委托: 附近日期芯片 (无结果时显示)
  document.addEventListener('click', e => {
    const chip = e.target.closest('.nearby-date-chip');
    if (chip) {
      const date = chip.dataset.date;
      const searchDate = $('#search-date');
      if (searchDate) searchDate.value = date;
      performAdvancedSearch();
      return;
    }
    // "重置筛选"链接 (无结果区域)
    const resetLink = e.target.closest('#link-reset-filters');
    if (resetLink) {
      e.preventDefault();
      resetAllFilters();
      const fnEl = $('#search-flightno');
      if (fnEl) fnEl.value = '';
      performAdvancedSearch();
    }
  });
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
  // 填充机型 chips
  populateAircraftChips();
  // 填充快捷标签
  renderQuickChips();
}

/** 填充机型筛选 chips */
function populateAircraftChips() {
  const container = $('#aircraft-chips');
  if (!container) return;
  const types = sys.getAircraftTypes();
  container.innerHTML = types.map(t => {
    const active = State.activeAircraftTypes.includes(t) ? ' active' : '';
    return `<button class=\"chip${active}\" data-type=\"${esc(t)}\">✈ ${esc(t)}</button>`;
  }).join('');
}

/** 快捷价格标签 */
function updateQuickPriceChips() {
  renderQuickChips();
}

/** 渲染快捷筛选标签 */
function renderQuickChips() {
  const bar = $('#quick-chips-bar');
  if (!bar) return;
  const cabin = parseInt(($('#filter-price-cabin') && $('#filter-price-cabin').value) || 3);
  const range = sys.getPriceRange(cabin);
  const cLabel = {1:'头等',2:'商务',3:'经济'}[cabin] || '经济';

  const chips = [
    { label: `💰 ${cLabel}舱 ≤¥${Math.round(range.max * 0.3).toLocaleString()}`, action: 'maxPrice', value: Math.round(range.max * 0.3) },
    { label: `💰 ${cLabel}舱 ≤¥${Math.round(range.max * 0.5).toLocaleString()}`, action: 'maxPrice', value: Math.round(range.max * 0.5) },
    { label: `⏰ 早班出发`, action: 'timePeriod', value: 'morning' },
    { label: `⏰ 午班出发`, action: 'timePeriod', value: 'afternoon' },
    { label: `💺 余票≥10`, action: 'minSeats', value: '10' },
    { label: `💺 余票≥5`, action: 'minSeats', value: '5' },
  ];

  bar.innerHTML = '<span class=\"quick-chips-label\">快捷:</span>' +
    chips.map(c => `<button class=\"quick-chip\" data-action=\"${c.action}\" data-value=\"${c.value}\">${c.label}</button>`).join('');
}

/** 应用快捷筛选 */
function applyQuickChip(action, value) {
  switch (action) {
    case 'maxPrice':
      const maxEl = $('#filter-max-price');
      if (maxEl) { maxEl.value = value; maxEl.focus(); }
      break;
    case 'timePeriod':
      State.activeTimePeriod = value;
      // 更新时段 chips 的 active 状态
      const periodChips = document.querySelectorAll('#time-period-chips .chip');
      periodChips.forEach(c => c.classList.toggle('active', c.dataset.period === value));
      break;
    case 'minSeats':
      const seatsEl = $('#search-passengers');
      if (seatsEl) { seatsEl.value = value; }
      break;
  }
  toast(`已应用: ${action}`, 'info');
}

function populateFlightSelects() {
  const sel = $('#book-flight');
  if (!sel) return;
  sel.innerHTML = sys.flights.map(f =>
    `<option value="${esc(f.flightNo)}"${f.canceled ? ' disabled' : ''}>${esc(f.flightNo)} — ${esc(f.origin)}→${esc(f.destination)} (${esc(f.flightDate)}) ${f.canceled ? '❌已取消' : '余'+f.remaining}</option>`
  ).join('');
}

function populateManageSelects() {
  const rSel = $('#refund-flight'), wSel = $('#waitlist-flight');
  const html = sys.flights.map(f =>
    `<option value="${esc(f.flightNo)}"${f.canceled ? ' disabled' : ''}>${esc(f.flightNo)} — ${esc(f.origin)}→${esc(f.destination)}${f.canceled ? ' ❌已取消' : ''}</option>`
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
    let status;
    if (f.canceled) {
      status = '<span class="badge badge-cancelled">已取消</span>';
    } else if (f.isFull) {
      status = '<span class="badge badge-danger">满员</span>';
    } else if (f.remaining < 10) {
      status = '<span class="badge badge-warning">仅剩' + f.remaining + '座</span>';
    } else {
      status = '<span class="badge badge-success">有票</span>';
    }
    const wb = f.waitQueue.size ? ` <span class="badge badge-info">候${f.waitQueue.size}</span>` : '';
    const cancelBtn = f.canceled
      ? '<span style="font-size:11px;color:var(--text-light);">已处理</span>'
      : `<button class="btn btn-danger btn-sm btn-cancel-flight" data-flight="${esc(f.flightNo)}">取消航班</button>`;
    return `
      <tr class="clickable" data-idx="${i}">
        <td><strong>${esc(f.flightNo)}</strong></td>
        <td>${esc(f.origin)} → ${esc(f.destination)}</td>
        <td>${esc(f.planeNo)}</td><td>${esc(f.flightDate)}</td>
        <td>${f.departureTime}–${f.arrivalTime}</td>
        <td>${f.capacity}</td>
        <td><strong>${f.canceled ? '—' : f.remaining}</strong></td>
        <td>${status}${wb}</td>
        <td>
          <button class="btn btn-outline btn-sm btn-detail" data-idx="${i}">详情</button>
          ${cancelBtn}
        </td>
      </tr>
      <tr class="expand-row" id="expand-${i}" style="display:none">
        <td colspan="9">
          <div class="expand-inner-wrap">
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
  // 取消航班按钮
  tbody.querySelectorAll('.btn-cancel-flight').forEach(btn => {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      doCancelFlight(this.dataset.flight);
    });
  });
}

function toggleExpand(idx) {
  const el = document.getElementById(`expand-${idx}`);
  if (!el) return;
  if (el.style.display === 'none' || !el.classList.contains('open')) {
    el.style.display = '';
    // 触发回流后添加 open 类以启动动画
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.add('open');
      });
    });
  } else {
    el.classList.remove('open');
    // 等动画结束后隐藏
    setTimeout(() => {
      if (!el.classList.contains('open')) el.style.display = 'none';
    }, 420);
  }
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

// ======================== 共享搜索逻辑 ========================

/**
 * Hero 快捷搜索入口
 */
function performQuickSearch() {
  const origin = ($('#quick-origin') && $('#quick-origin').value.trim()) || '';
  const dest   = ($('#quick-dest')   && $('#quick-dest').value.trim())   || '';
  const date   = ($('#quick-date')   && $('#quick-date').value)          || '';
  const passengers = parseInt(($('#quick-passengers') && $('#quick-passengers').value) || 1);

  const originVal = origin.replace(/\s*\(.*\)\s*/, '');
  const destVal   = dest.replace(/\s*\(.*\)\s*/, '');
  const resultDiv = $('#quick-result');
  if (!resultDiv) return;

  saveSearchHistory(originVal, destVal);

  const options = { minSeats: passengers, includeFull: true };
  const results = sys.searchFlights(originVal || '', destVal || '', date, options);
  State.lastSearchResults = results;

  if (!results.length) {
    resultDiv.className = 'result-box error show';
    resultDiv.innerHTML = renderNoResults(originVal, destVal, date, passengers);
    return;
  }
  resultDiv.className = 'result-box success show';
  resultDiv.innerHTML = renderSearchResults(results);
  bindResultActions(results);
}

/**
 * 高级搜索入口 — 收集所有筛选条件
 */
function performAdvancedSearch() {
  const origin = ($('#search-origin')   && $('#search-origin').value)   || '';
  const dest   = ($('#search-dest')     && $('#search-dest').value)     || '';
  const flightNo = ($('#search-flightno') && $('#search-flightno').value.trim()) || '';
  const date   = ($('#search-date')     && $('#search-date').value)     || '';
  const passengers = parseInt(($('#search-passengers') && $('#search-passengers').value) || 1);

  const originVal = origin.replace(/\s*\(.*\)\s*/, '');
  const destVal   = dest.replace(/\s*\(.*\)\s*/, '');

  saveSearchHistory(originVal, destVal, flightNo);

  const options = collectFilterOptions(passengers);
  const results = sys.searchFlights(originVal || '', destVal || '', date, options);
  State.lastSearchResults = results;

  const resultDiv = $('#search-result');
  if (!resultDiv) return;

  if (!results.length) {
    resultDiv.className = 'result-box error show';
    resultDiv.innerHTML = renderNoResults(originVal, destVal, date, passengers, options);
    return;
  }
  resultDiv.className = 'result-box success show';
  resultDiv.innerHTML = renderSearchResults(results);

  // 如果应用了筛选，显示筛选摘要
  if (hasActiveFilters(options)) {
    const summary = renderFilterSummary(options, results.length);
    const sortBar = resultDiv.querySelector('.search-sort-bar');
    if (sortBar) sortBar.insertAdjacentHTML('afterend', summary);
  }

  bindResultActions(results);
}

/** 收集所有高级筛选选项 */
function collectFilterOptions(passengers = 1) {
  const minPrice = parseInt(($('#filter-min-price') && $('#filter-min-price').value) || null) || undefined;
  const maxPrice = parseInt(($('#filter-max-price') && $('#filter-max-price').value) || null) || undefined;
  const cabinClass = parseInt(($('#filter-price-cabin') && $('#filter-price-cabin').value) || 3);
  const includeFull = ($('#filter-include-full') && $('#filter-include-full').checked) || false;
  const includeCancelled = ($('#filter-include-cancelled') && $('#filter-include-cancelled').checked) || false;

  return {
    flightNo: ($('#search-flightno') && $('#search-flightno').value.trim()) || undefined,
    minSeats: passengers,
    timePeriod: State.activeTimePeriod !== 'all' ? State.activeTimePeriod : undefined,
    minPrice,
    maxPrice,
    cabinClass,
    aircraftTypes: State.activeAircraftTypes.length > 0 ? [...State.activeAircraftTypes] : undefined,
    includeFull,
    includeCancelled,
  };
}

/** 是否有活跃的筛选条件 */
function hasActiveFilters(opts) {
  return !!(opts.flightNo || opts.timePeriod ||
    opts.minPrice || opts.maxPrice ||
    opts.aircraftTypes || !opts.includeFull || opts.includeCancelled);
}

/** 无结果时的渲染 */
function renderNoResults(origin, dest, date, passengers, options) {
  let html = '';
  const route = [];
  if (origin) route.push(origin);
  if (dest) route.push(dest);
  const routeStr = route.join(' → ') || '全部航线';

  if (date) {
    html += `<p style="margin-bottom:12px;">📅 <strong>${esc(date)}</strong> 无 ${routeStr} 航班</p>`;
    // 建议查看附近日期
    const dates = sys.getAvailableDates();
    const targetIdx = dates.indexOf(date);
    if (targetIdx >= 0) {
      const nearby = [];
      if (targetIdx > 0) nearby.push(dates[targetIdx - 1]);
      if (targetIdx < dates.length - 1) nearby.push(dates[targetIdx + 1]);
      if (nearby.length) {
        html += `<p style="font-size:13px;color:var(--text-mid);margin-bottom:8px;">💡 试试附近日期:</p>`;
        html += nearby.map(d =>
          `<button class="chip nearby-date-chip" data-date="${d}">📅 ${d}</button>`
        ).join(' ');
      }
    }
  } else if (origin || dest) {
    html += `<p>未找到 ${routeStr} 的航班</p>`;
  } else {
    html += '<p>未找到匹配航班</p>';
  }

  // 如果筛选条件过多，建议放宽
  if (options && hasActiveFilters(options)) {
    html += `<p style="margin-top:8px;font-size:12px;color:var(--text-light);">💡 请尝试放宽筛选条件或<a href="javascript:void(0)" id="link-reset-filters" style="color:var(--primary);text-decoration:underline;">重置筛选</a></p>`;
  }

  if (passengers > 1) {
    html += `<p style="font-size:12px;color:var(--text-light);margin-top:4px;">👥 当前搜索要求至少 ${passengers} 个可用座位</p>`;
  }
  return html;
}

/** 筛选摘要 */
function renderFilterSummary(options, resultCount) {
  const tags = [];
  if (options.flightNo) tags.push(`航班号: ${esc(options.flightNo)}`);
  if (options.timePeriod) {
    const labels = { morning: '早班6-12', afternoon: '午班12-18', evening: '晚班18-24', night: '夜航0-6' };
    tags.push(`时段: ${labels[options.timePeriod]}`);
  }
  if (options.minPrice || options.maxPrice) {
    const cab = {1:'头等',2:'商务',3:'经济'}[options.cabinClass||3];
    const range = [];
    if (options.minPrice) range.push(`≥¥${options.minPrice.toLocaleString()}`);
    if (options.maxPrice) range.push(`≤¥${options.maxPrice.toLocaleString()}`);
    tags.push(`${cab}舱 ${range.join(' ')}`);
  }
  if (options.aircraftTypes) tags.push(`机型: ${options.aircraftTypes.join(', ')}`);
  if (!options.includeFull) tags.push('不含满员');
  if (options.includeCancelled) tags.push('含已取消');

  if (!tags.length) return '';
  return `<div class="filter-summary">
    <span style="font-size:12px;color:var(--text-light);">🔍 已应用筛选: ${tags.join(' | ')} — 找到 <strong>${resultCount}</strong> 个结果</span>
  </div>`;
}

/** 保存搜索历史 */
function saveSearchHistory(origin, dest, flightNo) {
  if (!origin && !dest && !flightNo) return;
  const entry = { origin, dest, flightNo, time: Date.now() };
  // 去重
  State.searchHistory = State.searchHistory.filter(h =>
    !(h.origin === entry.origin && h.dest === entry.dest && h.flightNo === entry.flightNo)
  );
  State.searchHistory.unshift(entry);
  if (State.searchHistory.length > 5) State.searchHistory.pop();
}

// ======================== 筛选面板控制 ========================

/** 切换高级筛选面板显示 */
function toggleFilterPanel() {
  const panel = $('#filter-panel');
  const btn = $('#btn-toggle-filters');
  if (!panel || !btn) return;
  const isOpen = panel.style.display !== 'none';
  if (isOpen) {
    panel.style.display = 'none';
    btn.classList.remove('open');
    btn.querySelector('.filter-toggle-arrow').textContent = '▾';
  } else {
    panel.style.display = 'block';
    btn.classList.add('open');
    btn.querySelector('.filter-toggle-arrow').textContent = '▴';
    // 确保机型 chips 已填充
    if (!panel.querySelector('#aircraft-chips').children.length) {
      populateAircraftChips();
    }
  }
}

/** 初始化 chip 组选择 */
function initChipGroup(containerId, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    // 单选模式: 取消所有, 激活当前
    container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const value = chip.dataset.period || chip.dataset.type || chip.dataset.value;
    if (onChange) onChange(value);
  });
}

/** 重置所有筛选条件 */
function resetAllFilters() {
  State.activeTimePeriod = 'all';
  State.activeAircraftTypes = [];
  // 时段 chips
  const periodChips = document.querySelectorAll('#time-period-chips .chip');
  periodChips.forEach(c => c.classList.toggle('active', c.dataset.period === 'all'));
  // 价格
  const minEl = $('#filter-min-price'), maxEl = $('#filter-max-price');
  if (minEl) minEl.value = '';
  if (maxEl) maxEl.value = '';
  // 机型 chips
  const acChips = document.querySelectorAll('#aircraft-chips .chip');
  acChips.forEach(c => c.classList.remove('active'));
  // checkbox
  const inclFull = $('#filter-include-full');
  if (inclFull) inclFull.checked = true;
  const inclCancelled = $('#filter-include-cancelled');
  if (inclCancelled) inclCancelled.checked = false;
  // 航班号
  const fnEl = $('#search-flightno');
  if (fnEl) fnEl.value = '';
  toast('筛选条件已重置', 'info');
}

// ======================== 搜索 UI ========================

function renderSearchTableRows(results) {
  return results.map(r => {
    const fillPercent = Math.round((1 - r.remaining / r.capacity) * 100);
    const fillClass = fillPercent >= 95 ? 'low' : fillPercent >= 80 ? 'medium' : 'high';
    const seatLabel = r.isFull
      ? (r.waitQueueSize > 0 ? `满员 (候${r.waitQueueSize})` : '满员')
      : `余 ${r.remaining} 座`;
    return `
    <div class="flight-card">
      <div class="fc-route">
        <div><span class="fc-city">${esc(r.origin)}</span><br><span class="fc-code">${esc(r.originCode)}</span></div>
        <div class="fc-arrow">
          <span class="fc-duration">${r.durationLabel || ''}</span>
          <span class="fc-line"></span>
          <span class="fc-plane-icon">✈</span>
        </div>
        <div><span class="fc-city">${esc(r.destination)}</span><br><span class="fc-code">${esc(r.destCode)}</span></div>
      </div>
      <div class="fc-meta">
        <span class="fc-date">📅 ${r.flightDate}</span>
        <span class="fc-time">🕐 ${r.departureTime} – ${r.arrivalTime}</span>
        <span style="font-size:11px;color:var(--text-light);">✈ ${esc(r.planeNo)}</span>
      </div>
      <div class="fc-prices">
        <div class="fc-price-tag fc-first"><span class="fc-amount">¥${r.prices[1].toLocaleString()}</span><br><span class="fc-label">头等舱</span></div>
        <div class="fc-price-tag fc-business"><span class="fc-amount">¥${r.prices[2].toLocaleString()}</span><br><span class="fc-label">商务舱</span></div>
        <div class="fc-price-tag fc-economy"><span class="fc-amount">¥${r.prices[3].toLocaleString()}</span><br><span class="fc-label">经济舱</span></div>
      </div>
      <div class="fc-seats">
        <div class="fc-seats-bar"><div class="fc-seats-fill ${fillClass}" style="width:${fillPercent}%;"></div></div>
        <span style="font-size:13px;font-weight:600;white-space:nowrap;" class="${r.isFull ? 'text-danger' : 'text-success'}">${seatLabel}</span>
      </div>
      <div class="fc-actions">
        ${r.isFull
          ? '<button class="btn btn-outline btn-sm btn-waitlist-action" data-flight="'+esc(r.flightNo)+'">📝 候补</button>'
          : '<button class="btn btn-primary btn-sm btn-book-action" data-flight="'+esc(r.flightNo)+'">🎫 预订</button>'}
      </div>
    </div>`;
  }).join('');
}

function sortResults(criterion) {
  if (!State.lastSearchResults.length) return;
  const sorted = [...State.lastSearchResults];
  switch (criterion) {
    case 'price1-asc':  sorted.sort((a, b) => a.prices[1] - b.prices[1]); break;
    case 'price1-desc': sorted.sort((a, b) => b.prices[1] - a.prices[1]); break;
    case 'price2-asc':  sorted.sort((a, b) => a.prices[2] - b.prices[2]); break;
    case 'price2-desc': sorted.sort((a, b) => b.prices[2] - a.prices[2]); break;
    case 'price3-asc':  sorted.sort((a, b) => a.prices[3] - b.prices[3]); break;
    case 'price3-desc': sorted.sort((a, b) => b.prices[3] - a.prices[3]); break;
    case 'time-asc':    sorted.sort((a, b) => a.departureTime.localeCompare(b.departureTime)); break;
    case 'time-desc':   sorted.sort((a, b) => b.departureTime.localeCompare(a.departureTime)); break;
    case 'duration-asc': sorted.sort((a, b) => (a.duration || 0) - (b.duration || 0)); break;
    case 'remaining-desc': sorted.sort((a, b) => b.remaining - a.remaining); break;
    default: break;
  }
  const container = document.querySelector('#search-result .flight-cards') || document.querySelector('#quick-result .flight-cards');
  if (container) container.innerHTML = renderSearchTableRows(sorted);
}

function renderSearchResults(results) {
  State.lastSearchResults = results;
  return `
    <div class="search-sort-bar">
      <label>排序:</label>
      <select id="search-sort-select">
        <option value="default">默认顺序</option>
        <option value="price3-asc">经济舱价格 ↑</option>
        <option value="price3-desc">经济舱价格 ↓</option>
        <option value="price2-asc">商务舱价格 ↑</option>
        <option value="price2-desc">商务舱价格 ↓</option>
        <option value="price1-asc">头等舱价格 ↑</option>
        <option value="price1-desc">头等舱价格 ↓</option>
        <option value="time-asc">起飞时间早→晚</option>
        <option value="time-desc">起飞时间晚→早</option>
        <option value="duration-asc">飞行时长短→长</option>
        <option value="remaining-desc">余票多→少</option>
      </select>
    </div>
    <p class="search-result-count">找到 <strong>${results.length}</strong> 个航班</p>
    <div class="flight-cards">${renderSearchTableRows(results)}</div>`;
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
  // "候补"按钮 → 打开模态框
  document.querySelectorAll('.btn-waitlist-action').forEach(btn => {
    btn.addEventListener('click', () => {
      openWaitlistModal(btn.dataset.flight);
    });
  });
  // 附近日期芯片 → 重新搜索
  document.querySelectorAll('.nearby-date-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const date = chip.dataset.date;
      // 设置日期并重新搜索
      const searchDate = $('#search-date');
      if (searchDate) searchDate.value = date;
      performAdvancedSearch();
    });
  });
  // "重置筛选"链接 (在无结果区域)
  const resetLink = $('#link-reset-filters');
  if (resetLink) {
    resetLink.addEventListener('click', (e) => {
      e.preventDefault();
      resetAllFilters();
      // 重新搜索
      $('#search-flightno').value = '';
      performAdvancedSearch();
    });
  }
}

// ======================== 候补登记模态框 ========================

function openWaitlistModal(flightNo) {
  State.pendingWaitlistFlight = flightNo;
  const f = sys.findFlight(flightNo);
  const infoEl = $('#wl-flight-info');
  if (infoEl && f) {
    infoEl.textContent = `${f.flightNo} — ${f.origin}→${f.destination} (${f.flightDate})`;
  }
  // 重置表单
  const fields = { 'wl-name': '', 'wl-count': '1', 'wl-cabin': '3', 'wl-contact': '' };
  for (const [id, val] of Object.entries(fields)) {
    const el = $('#' + id);
    if (el) el.value = val;
  }
  const modal = $('#waitlist-modal');
  if (modal) modal.classList.add('show');
  // 聚焦姓名输入
  setTimeout(() => { const nm = $('#wl-name'); if (nm) nm.focus(); }, 150);
}

function closeWaitlistModal() {
  const modal = $('#waitlist-modal');
  if (modal) modal.classList.remove('show');
  State.pendingWaitlistFlight = null;
}

function submitWaitlist() {
  const flightNo = State.pendingWaitlistFlight;
  if (!flightNo) { toast('请先选择航班', 'warning'); return; }

  const name    = ($('#wl-name')    && $('#wl-name').value.trim())    || '';
  const count   = parseInt(($('#wl-count')   && $('#wl-count').value))   || 1;
  const cabin   = parseInt(($('#wl-cabin')   && $('#wl-cabin').value))   || 3;
  const contact = ($('#wl-contact') && $('#wl-contact').value.trim()) || '';

  if (!name) { toast('请输入旅客姓名', 'warning'); return; }
  if (count <= 0) { toast('请输入有效的票数', 'warning'); return; }

  const res = sys.joinWaitlist(flightNo, name, count, cabin, contact);
  if (res.success) toast(res.message, 'success');
  else toast(res.message, 'error');

  closeWaitlistModal();
  refreshAll();
}

// ======================== 订票流程 ========================

function updateStepProgress(step) {
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById(`step-dot-${i}`);
    const line = document.getElementById(`step-line-${i}`);
    if (dot) {
      dot.classList.remove('active', 'done');
      if (i < step) dot.classList.add('done');
      if (i === step) dot.classList.add('active');
    }
    if (line && i < 3) {
      line.classList.toggle('done', i < step);
    }
  }
}

function resetBooking() {
  State.selectedFlight = null;
  State.selectedSeats = [];
  State.seatCabinMap = {};
  $('#flight-preview').innerHTML = '';
  $('#seat-map-container').innerHTML = '<p class="empty-state">✈ 请先选择航班查看座位图</p>';
  $('#book-result').className = 'result-box';
  $('#book-step2-card').classList.add('step-disabled');
  $('#book-name').value = '';
  $('#book-contact').value = '';
  $('#book-count').value = '1';
  $('#book-cabin').value = '3';
  updateStepProgress(1);
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
  State.selectedFlight = f;
  State.selectedSeats = [];
  State.seatCabinMap = {};

  // 航班预览 — 登机牌风格
  $('#flight-preview').innerHTML = `
    <div class="boarding-pass">
      <div class="bp-left">
        <div class="bp-route">
          <span>${esc(f.origin)} <small style="color:var(--text-light);">${f.originCode}</small></span>
          <span style="color:var(--gold);">✈</span>
          <span>${esc(f.destination)} <small style="color:var(--text-light);">${f.destCode}</small></span>
        </div>
        <div class="bp-flightno">${esc(f.flightNo)}</div>
        <div class="bp-meta">
          <span>📅 <strong>${esc(f.flightDate)}</strong></span>
          <span>🕐 <strong>${f.departureTime} – ${f.arrivalTime}</strong></span>
          <span>✈ <strong>${esc(f.planeNo)}</strong></span>
          <span>💺 <strong>${f.remaining}</strong> / ${f.capacity} 座可用</span>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <span class="badge badge-gold">头等 ¥${f.prices[1].toLocaleString()}</span>
          <span class="badge badge-info">商务 ¥${f.prices[2].toLocaleString()}</span>
          <span class="badge badge-success">经济 ¥${f.prices[3].toLocaleString()}</span>
        </div>
      </div>
      <div class="bp-right">
        <div class="bp-price-label">起步票价</div>
        <div class="bp-price">¥${Math.min(f.prices[1], f.prices[2], f.prices[3]).toLocaleString()}</div>
        <div style="font-size:11px;color:var(--text-light);">经济舱起</div>
      </div>
    </div>`;

  // 渲染座位图
  renderSeatMap(f);

  // 解锁步骤2
  $('#book-step2-card').classList.remove('step-disabled');
  updateStepProgress(2);
  renderPassengerForms();
  $('#book-name').focus();
}

/** 座位图渲染 — 液态玻璃机身 + 舱位分区 + 出口门标识 */
function renderSeatMap(f) {
  const map = f.getSeatMap();
  const exitRows = new Set(map.exitRows);

  // 渲染时同步构建 seatCabinMap (不从 DOM 反查)
  State.seatCabinMap = {};

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
        // 过道前置 (D列前)
        if (col.letter === 'D') {
          html += '<span class="seat-aisle"></span>';
        }

        if (!col.exists) {
          html += '<span class="seat nonexist"></span>';
        } else if (col.occupied) {
          html += `<span class="seat occupied" title="${col.id} (已占用)">
            <span class="seat-tip">${col.id} 已占用</span>✕</span>`;
        } else {
          // 记录座位→舱位映射 (在渲染时直接构建)
          State.seatCabinMap[col.id] = zone.cabinClass;

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

  // 绑定座位点击事件 — 右驱左: 直接多选, 跨舱位, 数量自动跟随
  document.querySelectorAll('#seat-map-container .seat-click').forEach(el => {
    el.addEventListener('click', function () {
      const seatId = this.dataset.seat;

      if (this.classList.contains('selected')) {
        // 取消选中
        this.classList.remove('selected');
        State.selectedSeats = State.selectedSeats.filter(s => s !== seatId);
      } else {
        // 选中 — 无上限, 不限舱位
        this.classList.add('selected');
        State.selectedSeats.push(seatId);
      }

      // 订票数量自动跟随已选座位数
      const cntInput = $('#book-count');
      if (cntInput) cntInput.value = State.selectedSeats.length || 1;
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

  if (State.selectedSeats.length === 0) {
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
  for (const s of State.selectedSeats) { const c = State.seatCabinMap[s] || 3; tally[c] = (tally[c] || 0) + 1; }
  const parts = [];
  if (tally[1]) parts.push(`头等舱 ×${tally[1]}`);
  if (tally[2]) parts.push(`商务舱 ×${tally[2]}`);
  if (tally[3]) parts.push(`经济舱 ×${tally[3]}`);
  if (cabinSum) cabinSum.innerHTML = `📋 已选 <strong>${State.selectedSeats.length}</strong> 座: ${parts.join(' + ')} — 请为每位旅客填写信息`;

  // 逐座输入行
  if (multiList) {
    multiList.innerHTML = State.selectedSeats.map(seatId => {
      const cabin = State.seatCabinMap[seatId] || 3;
      const cn = {1:'头等舱',2:'商务舱',3:'经济舱'}[cabin];
      const css = {1:'cabin-first',2:'cabin-business',3:'cabin-economy'}[cabin];
      const price = State.selectedFlight ? State.selectedFlight.getPrice(cabin).toLocaleString() : '—';
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
  }

  updatePriceDisplay();
  syncFormIndicators();
}

function updatePriceDisplay() {
  if (!State.selectedFlight) return;

  // 更新舱位选择框的选项文字(带价格)
  const cabinSelect = $('#book-cabin');
  if (cabinSelect && cabinSelect.options) {
    const labels = ['', '头等舱', '商务舱', '经济舱'];
    for (let i = 1; i <= 3; i++)
      if (cabinSelect.options[i - 1]) cabinSelect.options[i - 1].textContent = `${labels[i]} — ¥${State.selectedFlight.prices[i].toLocaleString()}`;
  }

  // 旅客类型折扣乘数 — 多选模式逐座计算, 单选模式统一
  let total = 0;
  const cabinCounts = { 1: 0, 2: 0, 3: 0 };

  if (State.selectedSeats.length > 0) {
    // 多选模式: 每座按其旅客类型独立计价
    const rows = document.querySelectorAll('#multi-pax-list .passenger-row');
    if (rows.length > 0) {
      rows.forEach(row => {
        const nameInput = row.querySelector('.pax-name');
        const typeSelect = row.querySelector('.pax-type');
        const seatId = nameInput ? nameInput.dataset.seat : null;
        const paxType = typeSelect ? typeSelect.value : 'adult';
        const mult = { adult: 1.0, child: 0.75, infant: 0.1 }[paxType] || 1.0;
        const cabin = seatId ? (State.seatCabinMap[seatId] || 3) : 3;
        total += Math.round(State.selectedFlight.getPrice(cabin) * mult);
        cabinCounts[cabin] = (cabinCounts[cabin] || 0) + 1;
      });
    } else {
      // 行尚未渲染时的后备
      for (const s of State.selectedSeats) {
        const c = State.seatCabinMap[s] || 3;
        total += State.selectedFlight.getPrice(c);
        cabinCounts[c] = (cabinCounts[c] || 0) + 1;
      }
    }
  } else {
    // 单选模式: 统一舱位 × 数量 × 类型
    const paxType = ($('#book-passenger-type') && $('#book-passenger-type').value) || 'adult';
    const mult = { adult: 1.0, child: 0.75, infant: 0.1 }[paxType] || 1.0;
    const formCabin = parseInt(($('#book-cabin') && $('#book-cabin').value) || 3);
    const formCount = parseInt(($('#book-count') && $('#book-count').value) || 1);
    total = Math.round(State.selectedFlight.getPrice(formCabin) * formCount * mult);
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
  summary.innerHTML = `💺 已选 <strong>${State.selectedSeats.length}</strong> 座 &nbsp;|&nbsp;
    ${cabinDetail} &nbsp;|&nbsp;
    <strong>合计 ¥${total.toLocaleString()}</strong>`;
}

/** 将已选座位同步回左侧表单指示器 (不改变用户手动输入的值) */
function syncFormIndicators() {
  const cabinSelect = $('#book-cabin');
  if (!cabinSelect || !State.selectedFlight) return;

  let hint = document.getElementById('cabin-selection-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'cabin-selection-hint';
    hint.className = 'cabin-hint';
    const legend = $('#seat-map-container + .seat-legend');
    if (legend) legend.parentNode.insertBefore(hint, legend.nextSibling);
  }
  if (State.selectedSeats.length > 0) {
    const tally = {};
    for (const s of State.selectedSeats) { const c = State.seatCabinMap[s] || 3; tally[c] = (tally[c] || 0) + 1; }
    const parts = [];
    if (tally[1]) parts.push(`头等×${tally[1]}`);
    if (tally[2]) parts.push(`商务×${tally[2]}`);
    if (tally[3]) parts.push(`经济×${tally[3]}`);
    hint.innerHTML = `已选 <strong>${State.selectedSeats.length}</strong> 座: ${parts.join(' + ')}`;
    hint.classList.add('locked');
  } else {
    hint.innerHTML = '点击座位直接选择，支持跨舱位多选';
    hint.classList.remove('locked');
  }
}

/** 步骤2→3: 确认订票 (支持多乘客逐座预订, 带预校验) */
function doBook() {
  if (!State.selectedFlight) { toast('请先选择航班', 'warning'); return; }
  const contact = ($('#book-contact') && $('#book-contact').value || '').trim();

  // ====== 多选模式: 逐座逐旅客订票 ======
  if (State.selectedSeats.length > 0) {
    const rows = document.querySelectorAll('#multi-pax-list .passenger-row');
    const passengers = [];

    // —— 预校验阶段: 收集所有乘客信息, 验证完整性 ————
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
      if (passengers.some(p => p.name === name)) {
        toast(`旅客 "${name}" 重复，请使用不同的姓名`, 'warning');
        if (nameInput) nameInput.focus();
        return;
      }
      passengers.push({ name, paxType, seatId, cabin: State.seatCabinMap[seatId] || 3 });
    }

    // 检查余票是否充足
    if (State.selectedFlight.remaining < passengers.length) {
      toast(`余票不足 (剩余 ${State.selectedFlight.remaining} 张, 需要 ${passengers.length} 张)`, 'error');
      return;
    }

    // 检查座位是否仍可用 (二次确认)
    const occupied = State.selectedFlight.occupiedSeats();
    for (const p of passengers) {
      if (occupied.has(p.seatId)) {
        toast(`座位 ${p.seatId} 已被占用，请重新选择`, 'error');
        return;
      }
    }

    // —— 执行阶段: 全部校验通过后逐人预订 ————
    const results = [];
    for (const p of passengers) {
      const res = sys.bookTicket(
        State.selectedFlight.flightNo, p.name, 1, p.cabin, p.paxType, contact,
        [p.seatId], { [p.seatId]: p.cabin }
      );
      if (!res.success) {
        toast(res.message, 'error');
        // 极端情况下的部分成功 (校验通过后仍失败)
        if (results.length > 0) {
          showMultiBookingResult(results);
          toast('部分预订成功，请检查已生成的 PNR；未成功的订单未扣款', 'warning');
        }
        return;
      }
      results.push(res);
    }

    showMultiBookingResult(results);
    toast(`预订成功! ${results.length} 位旅客`, 'success');
    updateStepProgress(3);
    setTimeout(() => { resetBooking(); }, 20000);
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

  const res = sys.bookTicket(State.selectedFlight.flightNo, name, count, cabin, paxType, contact);

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
          <div class="detail-item"><div class="dl">日期</div><div class="dv">${res.flightDate}</div></div>
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
    updateStepProgress(3);
    setTimeout(() => { resetBooking(); }, 8000);
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
      const wr = sys.joinWaitlist(State.selectedFlight.flightNo, name, count, cabin, contact);
      if (wr.success) {
        resultDiv.className = 'result-box info show';
        resultDiv.innerHTML = `<p>📝 ${esc(wr.message)}</p>`;
        toast(wr.message, 'success');
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

function doPNRLookup() {
  const pnr = $('#pnr-lookup').value.trim().toUpperCase();
  const resultDiv = $('#pnr-result');
  if (!pnr) { toast('请输入 PNR 参考号', 'warning'); return; }

  const info = sys.lookupByPNR(pnr);
  if (!info.found) {
    resultDiv.className = 'result-box error show';
    resultDiv.innerHTML = `<p>❌ 未找到 PNR <strong>${esc(pnr)}</strong> 对应的订票记录</p>`;
    $('#btn-pnr-refund').style.display = 'none';
    State.currentPNR = null;
    return;
  }

  State.currentPNR = pnr;
  resultDiv.className = 'result-box success show';
  resultDiv.innerHTML = `
    <p style="font-weight:700;margin-bottom:12px;">✅ 找到订票记录</p>
    <div class="pnr-card">
      <div class="pnr-code" style="font-size:28px;">${info.pnr}</div>
      <div class="booking-detail">
        <div class="detail-item"><div class="dl">旅客</div><div class="dv">${esc(info.name)}</div></div>
        <div class="detail-item"><div class="dl">航班</div><div class="dv">${info.flightNo}</div></div>
        <div class="detail-item"><div class="dl">航线</div><div class="dv">${esc(info.origin)} → ${esc(info.destination)}</div></div>
        <div class="detail-item"><div class="dl">日期</div><div class="dv">${info.flightDate} ${info.departureTime}</div></div>
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

async function doPNRRefund() {
  if (!State.currentPNR) return;
  const ok = await showConfirm('确认退票', `使用 PNR ${State.currentPNR} 办理退票? 退票后该订票记录将作废。`, '💵');
  if (!ok) return;

  const res = sys.refundByPNR(State.currentPNR);
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
    State.currentPNR = null;
    refreshAll();
  } else {
    toast(res.message, 'error');
  }
}

// ======================== 按姓名退票 ========================

async function doRefund() {
  const flightNo = $('#refund-flight').value;
  const name = $('#refund-name').value;
  const resultDiv = $('#refund-result');
  if (!name) { toast('请选择客户姓名', 'warning'); return; }
  const ok = await showConfirm('确认退票', `航班: ${flightNo}\n旅客: ${name}`, '💵');
  if (!ok) return;

  const res = sys.refundTicket(flightNo, name);
  if (res.success) {
    let html = `<p>✅ ${esc(res.message)}</p>`;
    if (res.fulfilled && res.fulfilled.length > 0) {
      html += `<p style="margin-top:8px;">🔄 候补队列自动补位:</p><ul>`;
      for (const ff of res.fulfilled)
        html += `<li>${esc(ff.name)} → ${ff.ticketCount}张 (PNR: ${ff.pnr})</li>`;
      html += '</ul>';
      toast(`已自动为 ${res.fulfilled.length} 位候补客户办理订票`, 'success');
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

// ======================== 取消航班 ========================

async function doCancelFlight(flightNo) {
  const f = sys.findFlight(flightNo);
  if (!f) { toast('航班不存在', 'error'); return; }
  if (f.canceled) { toast('该航班已被取消', 'warning'); return; }

  const bookedCount = f.bookedList.size;
  const waitCount = f.waitQueue.size;

  let warnMsg = `确认取消航班 ${flightNo}？`;
  if (bookedCount > 0) warnMsg += `\n⚠ 将自动退票 ${f.bookedList.getTotalBooked()} 张 (${bookedCount} 位旅客)`;
  if (waitCount > 0) warnMsg += `\n📋 候补队列中 ${waitCount} 人将被清退`;
  if (bookedCount === 0 && waitCount === 0) warnMsg += `\n该航班无订票和候补记录`;

  const ok = await showConfirm('取消航班', warnMsg, '🚫');
  if (!ok) return;

  const res = sys.cancelFlight(flightNo);
  if (!res.success) { toast(res.message, 'error'); return; }

  // 构建结果展示
  let html = `<div style="font-size:16px;font-weight:700;margin-bottom:16px;">🚫 航班 ${esc(flightNo)} 已取消</div>`;

  if (res.refundedPassengers.length > 0) {
    html += `<div style="margin-bottom:12px;">
      <p style="font-weight:600;margin-bottom:8px;">✅ 已自动退票 ${res.totalRefundedTickets} 张 (${res.totalRefundedPassengers} 位旅客):</p>
      <div class="table-wrap"><table class="sub-table">
        <thead><tr><th>旅客</th><th>票数</th><th>舱位</th><th>座位</th><th>PNR</th></tr></thead>
        <tbody>${res.refundedPassengers.map(r => `
          <tr><td>${esc(r.name)}</td><td>${r.ticketCount}</td>
          <td>${r.cabinName}</td><td>${r.seatNumbers.join(', ')}</td>
          <td><code>${r.pnr}</code></td></tr>
        `).join('')}</tbody>
      </table></div>
      <p style="margin-top:6px;font-size:12px;color:var(--text-light);">
        📌 快捷退票参考号: <strong>${res.pnrList.join(', ')}</strong>
      </p>
    </div>`;
  } else {
    html += '<p style="color:var(--text-mid);margin-bottom:12px;">该航班无已订票旅客，无需退票。</p>';
  }

  if (res.waitlistedPassengers.length > 0) {
    html += `<div>
      <p style="font-weight:600;margin-bottom:6px;">📋 已清退候补队列 (${res.totalWaitlisted} 人):</p>
      <div class="table-wrap"><table class="sub-table">
        <thead><tr><th>旅客</th><th>需票</th><th>舱位</th><th>联系方式</th></tr></thead>
        <tbody>${res.waitlistedPassengers.map(w => `
          <tr><td>${esc(w.name)}</td><td>${w.ticketCount}</td>
          <td>${w.cabinName}</td><td>${esc(w.contact||'—')}</td></tr>
        `).join('')}</tbody>
      </table></div>
    </div>`;
  }

  // 在总览页展示结果
  const resultDiv = document.createElement('div');
  resultDiv.className = 'result-box warning show';
  resultDiv.style.marginTop = '16px';
  resultDiv.innerHTML = html;
  const overview = document.getElementById('tab-overview');
  if (overview) {
    // 移除旧的结果展示
    const old = overview.querySelector('.cancel-result');
    if (old) old.remove();
    resultDiv.classList.add('cancel-result');
    overview.appendChild(resultDiv);
  }

  toast(res.message, 'success');
  refreshAll();
}

// ======================== 数据导入/导出 ========================

function exportData() {
  try {
    const data = sys.flights.map(f => ({
      origin: f.origin, originCode: f.originCode,
      destination: f.destination, destCode: f.destCode,
      flightNo: f.flightNo, planeNo: f.planeNo, flightDate: f.flightDate,
      departureTime: f.departureTime, arrivalTime: f.arrivalTime,
      capacity: f.capacity, prices: f.prices, remaining: f.remaining,
      bookedList: f.bookedList.toArray(),
      waitQueue: f.waitQueue.toArray(),
    }));
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `airline-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('数据导出成功', 'success');
  } catch (e) {
    toast('导出失败: ' + e.message, 'error');
  }
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error('数据格式错误');
      localStorage.setItem('airline_v2_data', JSON.stringify(data));
      const ok = sys.load();
      if (!ok) throw new Error('数据加载失败');
      refreshAll();
      toast(`导入成功! ${sys.flights.length} 条航线`, 'success');
    } catch (e) {
      toast('文件格式错误，导入失败: ' + e.message, 'error');
    }
  };
  reader.onerror = () => toast('文件读取失败', 'error');
  reader.readAsText(file);
}

// ======================== 录入航班 ========================

function doAddFlight() {
  const origin = $('#add-origin').value.trim();
  const originCode = $('#add-origin-code').value.trim().toUpperCase();
  const dest = $('#add-dest').value.trim();
  const destCode = $('#add-dest-code').value.trim().toUpperCase();
  const flightNo = $('#add-flightno').value.trim();
  const planeNo = $('#add-planeno').value.trim();
  const flightDate = $('#add-flightdate').value;
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
                flightNo, planeNo, flightDate, depTime, arrTime, capacity, prices);

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

async function resetAll() {
  const ok = await showConfirm('恢复测试数据', '确认恢复为测试数据? 当前所有数据将丢失!', '🔄');
  if (!ok) return;
  sys.clearAll();
  localStorage.removeItem('airline_v2_data');
  sys.initTestData();
  resetBooking();
  refreshAll();
  toast('数据已重置为测试数据', 'success');
}

// ======================== Toast (上限5条) ========================

function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  // 限制最多 5 条, 超出时移除最早的
  while (container.children.length >= 5) {
    container.firstChild.remove();
  }
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
  document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
}

function switchTab(tabId) {
  deactivateAllTabs();
  const btn = $(`[data-tab="${tabId}"]`);
  if (btn) { btn.classList.add('active'); btn.setAttribute('aria-selected', 'true'); }
  const content = document.getElementById(tabId);
  if (content) content.classList.add('active');
  // 更新 tab 滑动指示器
  setTimeout(updateTabIndicator, 50);
}
