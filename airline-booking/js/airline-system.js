/*
 * 航空客运订票系统 — 核心业务逻辑 (v2.0)
 * 航线表: 顺序存储结构, 按航班号有序
 */

// ==================== 航线记录 ====================

class Flight {
  /**
   * @param {string} origin        - 始发站
   * @param {string} originCode    - 始发站三字码 (PEK/SHA/CAN...)
   * @param {string} destination   - 终点站
   * @param {string} destCode      - 终点站三字码
   * @param {string} flightNo      - 航班号
   * @param {string} planeNo       - 飞机号/机型
   * @param {string} flightDate    - 飞行日期 "YYYY-MM-DD"
   * @param {string} departureTime - 起飞时刻 "HH:MM"
   * @param {string} arrivalTime   - 到达时刻 "HH:MM"
   * @param {number} capacity      - 乘员定额
   * @param {object} prices        - 各舱位票价 {1:头等舱, 2:商务舱, 3:经济舱}
   */
  constructor(origin, originCode, destination, destCode, flightNo, planeNo,
              flightDate, departureTime, arrivalTime, capacity, prices) {
    this.origin = origin;
    this.originCode = originCode;
    this.destination = destination;
    this.destCode = destCode;
    this.flightNo = flightNo;
    this.planeNo = planeNo;
    this.flightDate = flightDate;
    this.departureTime = departureTime;
    this.arrivalTime = arrivalTime;
    this.capacity = capacity;
    this.prices = prices || { 1: 5000, 2: 2500, 3: 800 };
    this.remaining = capacity;

    /** 已订票客户名单 — 按姓名排序的链表 */
    this.bookedList = new SortedLinkedList();
    /** 等候替补客户名单 — 链式队列 */
    this.waitQueue = new LinkedQueue();
    /** 航班是否已取消 */
    this.canceled = false;
  }

  get bookedCount() { return this.bookedList.getTotalBooked(); }
  get isFull() { return this.remaining <= 0; }

  /**
   * 按舱位等级自动分配座位 (每排6座 A-F)
   *
   * 舱位分区:
   *   头等舱 (1): 第 1-2 排, A/C/D/F 列
   *   商务舱 (2): 第 3-5 排, A/C/D/F 列
   *   经济舱 (3): 第 6+ 排,  全部6列
   *
   * 若目标舱位无空座则跨舱位回退分配
   *
   * @param {number} count      - 需要座位数
   * @param {number} cabinClass - 舱位等级 (1/2/3)
   * @returns {string[]}
   */
  generateSeatNumbers(count, cabinClass = 3) {
    const L = ['A','B','C','D','E','F'];
    const totalRows = Math.ceil(this.capacity / 6);
    const firstRows   = Math.min(2, totalRows);
    const businessRows = Math.min(3, Math.max(0, totalRows - firstRows));
    const economyStart = firstRows + businessRows + 1;

    // 确定目标舱位的行列范围
    let rowStart, rowEnd, validCols;
    if (cabinClass === 1) {
      rowStart = 1; rowEnd = firstRows;
      validCols = ['A','C','D','F'];
    } else if (cabinClass === 2) {
      rowStart = firstRows + 1; rowEnd = firstRows + businessRows;
      validCols = ['A','C','D','F'];
    } else {
      rowStart = economyStart; rowEnd = totalRows;
      validCols = ['A','B','C','D','E','F'];
    }

    const occupied = this.occupiedSeats();
    const seats = [];

    // 第一轮: 在目标舱位内分配
    for (let r = rowStart; r <= rowEnd && seats.length < count; r++) {
      for (const col of validCols) {
        if (seats.length >= count) break;
        const seatId = `${r}${col}`;
        const colIdx = L.indexOf(col);
        const globalIdx = (r - 1) * 6 + colIdx + 1;
        if (globalIdx <= this.capacity && !occupied.has(seatId) && !seats.includes(seatId)) {
          seats.push(seatId);
        }
      }
    }

    // 第二轮 (回退): 目标舱位不足时从全局空座补充
    if (seats.length < count) {
      for (let r = 1; r <= totalRows && seats.length < count; r++) {
        for (const col of L) {
          if (seats.length >= count) break;
          const seatId = `${r}${col}`;
          const colIdx = L.indexOf(col);
          const globalIdx = (r - 1) * 6 + colIdx + 1;
          if (globalIdx <= this.capacity && !occupied.has(seatId) && !seats.includes(seatId)) {
            seats.push(seatId);
          }
        }
      }
    }

    return seats;
  }

  /** 获取已被占用的座位号集合 */
  occupiedSeats() {
    const set = new Set();
    for (const c of this.bookedList.toArray()) {
      for (const s of c.seatNumbers || []) set.add(s);
    }
    return set;
  }

  /**
   * 生成完整座位图数据 (用于前端可视化)
   *
   * 舱位分区:
   *   头等舱 (First):  第 1-2 排 — 4座/排 (A, C | aisle | D, F) — 超大间距
   *   商务舱 (Business): 第 3-5 排 — 4座/排 (A, C | aisle | D, F)
   *   经济舱 (Economy): 第 6+ 排 — 6座/排 (A,B,C | aisle | D,E,F)
   *
   * @returns {{ zones: Array, exitRows: number[], totalRows: number }}
   */
  getSeatMap() {
    const occupied = this.occupiedSeats();
    const totalRows = Math.ceil(this.capacity / 6);

    // ---- 舱位分区定义 ----
    const firstRows   = Math.min(2, totalRows);                 // 头等舱: 前2排
    const businessRows = Math.min(3, Math.max(0, totalRows - firstRows)); // 商务舱: 接下去3排
    const economyStart = firstRows + businessRows + 1;          // 经济舱: 剩余排

    // 紧急出口排 (经济舱第1排和第11排标记为出口)
    const exitRows = [economyStart, Math.min(economyStart + 10, totalRows)];
    const exitRowSet = new Set(exitRows);

    const makeSeat = (seatId, rowNum, colLetter) => {
      const colIdx = ['A','B','C','D','E','F'].indexOf(colLetter);
      const globalIdx = (rowNum - 1) * 6 + colIdx + 1;
      const features = [];
      if (colLetter === 'A' || colLetter === 'F') features.push('window');
      if (colLetter === 'C' || colLetter === 'D') features.push('aisle');
      if (exitRowSet.has(rowNum)) features.push('extra_legroom');
      return {
        id: seatId,
        occupied: occupied.has(seatId),
        exists: globalIdx <= this.capacity,
        letter: colLetter,
        features,
      };
    };

    const zoneFirst = [];
    for (let r = 1; r <= firstRows; r++) {
      const cols = ['A','C','D','F'].map(l => makeSeat(`${r}${l}`, r, l));
      zoneFirst.push({ row: r, cols, layout: '1-2-1' });
    }

    const zoneBusiness = [];
    for (let r = firstRows + 1; r <= firstRows + businessRows; r++) {
      const cols = ['A','C','D','F'].map(l => makeSeat(`${r}${l}`, r, l));
      zoneBusiness.push({ row: r, cols, layout: '2-2' });
    }

    const zoneEconomy = [];
    for (let r = economyStart; r <= totalRows; r++) {
      const cols = ['A','B','C','D','E','F'].map(l => makeSeat(`${r}${l}`, r, l));
      zoneEconomy.push({ row: r, cols, layout: '3-3' });
    }

    return {
      zones: [
        { name: '头等舱', className: 'first', cabinClass: 1, color: '#e8c97a', bg: '#fef9e7', rows: zoneFirst },
        { name: '商务舱', className: 'business', cabinClass: 2, color: '#a3b8cc', bg: '#f0f4f8', rows: zoneBusiness },
        { name: '经济舱', className: 'economy', cabinClass: 3, color: '#b7d9b1', bg: '#f4faf2', rows: zoneEconomy },
      ].filter(z => z.rows.length > 0),
      exitRows,
      totalRows,
    };
  }

  /** 获取某舱位票价 */
  getPrice(cabinClass) {
    return this.prices[cabinClass] || this.prices[3];
  }
}


// ==================== 航空订票系统 ====================

class AirlineSystem {
  constructor() {
    /** @type {Flight[]} 航线汇总表 — 顺序存储, 按航班号有序 */
    this.flights = [];
  }

  // ======================== 航班管理 ========================

  addFlight(origin, originCode, destination, destCode, flightNo, planeNo,
            flightDate, departureTime, arrivalTime, capacity, prices) {
    const f = new Flight(origin, originCode, destination, destCode, flightNo,
                         planeNo, flightDate, departureTime, arrivalTime, capacity, prices);
    const idx = this.flights.findIndex(x => x.flightNo.localeCompare(flightNo) > 0);
    if (idx === -1) this.flights.push(f);
    else this.flights.splice(idx, 0, f);
    this._persist();
    return f;
  }

  findFlight(flightNo) {
    return this.flights.find(f => f.flightNo === flightNo);
  }

  // ======================== PNR 生成 ========================

  /** 生成唯一 6 位 PNR (字母+数字) */
  _generatePNR() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去除易混淆字符 I/O/0/1
    let pnr;
    do {
      pnr = '';
      for (let i = 0; i < 6; i++) pnr += chars[Math.floor(Math.random() * chars.length)];
    } while (this._pnrExists(pnr));
    return pnr;
  }

  _pnrExists(pnr) {
    return this.flights.some(f => f.bookedList.searchByPNR(pnr) !== null);
  }

  // ======================== 航线搜索 ========================

  /**
   * 计算航班飞行时长 (分钟)
   * 处理跨日到达: 若到达时刻 < 起飞时刻, 视为次日到达
   * @param {string} depTime - "HH:MM"
   * @param {string} arrTime - "HH:MM"
   * @returns {number} 飞行分钟数
   */
  static calcDuration(depTime, arrTime) {
    const [dH, dM] = depTime.split(':').map(Number);
    const [aH, aM] = arrTime.split(':').map(Number);
    let mins = (aH * 60 + aM) - (dH * 60 + dM);
    if (mins < 0) mins += 24 * 60; // 跨日到达
    return mins;
  }

  /** 格式化时长: 分钟 → "Xh Ym" */
  static formatDuration(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }

  /**
   * 增强航班搜索 (v2.4)
   *
   * 支持多维过滤:
   *   - origin / destination: 城市名模糊匹配 (空字符串=不限制)
   *   - dateStr:             飞行日期精确匹配 (可选)
   *   - options.flightNo:    航班号模糊匹配
   *   - options.minSeats:    最低余票数 (用于感知订票人数)
   *   - options.timePeriod:  出发时段 'morning'|'afternoon'|'evening'|'night'|'all'
   *   - options.minPrice / maxPrice: 价格区间 (需配合 cabinClass)
   *   - options.cabinClass:  用于价格筛选的舱位 (默认3-经济舱)
   *   - options.aircraftTypes: 机型列表 ['B787-9','A350-9']
   *   - options.includeFull: 是否包含满员航班 (默认 true)
   *   - options.includeCancelled: 是否包含已取消航班 (默认 false)
   *   - options.sortBy:      排序方式 'price-asc'|'price-desc'|'time-asc'|'time-desc'|'duration-asc'|'remaining-desc'
   *
   * @param {string} origin      - 始发站 (模糊匹配, 空=不限)
   * @param {string} destination - 终点站 (模糊匹配, 空=不限)
   * @param {string} dateStr     - 期望日期 "YYYY-MM-DD" (可选)
   * @param {object} options     - 高级过滤选项
   * @returns {object[]}
   */
  searchFlights(origin, destination, dateStr, options = {}) {
    const {
      flightNo, minSeats, timePeriod,
      minPrice, maxPrice, cabinClass,
      aircraftTypes, includeFull = true,
      includeCancelled = false, sortBy,
    } = options;

    let results = this.flights.filter(f => {
      // 基础过滤
      if (!includeCancelled && f.canceled) return false;
      if (origin && !f.origin.includes(origin)) return false;
      if (destination && !f.destination.includes(destination)) return false;
      if (dateStr && f.flightDate !== dateStr) return false;

      // 航班号模糊匹配
      if (flightNo && !f.flightNo.toUpperCase().includes(flightNo.toUpperCase())) return false;

      // 最低余票
      if (minSeats !== undefined && minSeats !== null && f.remaining < minSeats) return false;
      if (!includeFull && f.isFull) return false;

      // 出发时段
      if (timePeriod && timePeriod !== 'all') {
        const hour = parseInt(f.departureTime.split(':')[0], 10);
        const periodMap = {
          morning:   [6, 12],   // 06:00–11:59
          afternoon: [12, 18],  // 12:00–17:59
          evening:   [18, 24],  // 18:00–23:59
          night:     [0, 6],    // 00:00–05:59
        };
        const [lo, hi] = periodMap[timePeriod] || [0, 24];
        if (hour < lo || hour >= hi) return false;
      }

      // 价格区间 (按指定舱位)
      if ((minPrice !== undefined && minPrice !== null) ||
          (maxPrice !== undefined && maxPrice !== null)) {
        const targetCabin = cabinClass || 3;
        const price = f.prices[targetCabin];
        if (minPrice !== undefined && minPrice !== null && price < minPrice) return false;
        if (maxPrice !== undefined && maxPrice !== null && price > maxPrice) return false;
      }

      // 机型筛选
      if (aircraftTypes && aircraftTypes.length > 0 && !aircraftTypes.includes(f.planeNo)) {
        return false;
      }

      return true;
    });

    // 服务端排序
    if (sortBy) {
      const cabinForPrice = cabinClass || 3;
      switch (sortBy) {
        case 'price-asc':
          results.sort((a, b) => a.prices[cabinForPrice] - b.prices[cabinForPrice]);
          break;
        case 'price-desc':
          results.sort((a, b) => b.prices[cabinForPrice] - a.prices[cabinForPrice]);
          break;
        case 'time-asc':
          results.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
          break;
        case 'time-desc':
          results.sort((a, b) => b.departureTime.localeCompare(a.departureTime));
          break;
        case 'duration-asc':
          results.sort((a, b) =>
            AirlineSystem.calcDuration(a.departureTime, a.arrivalTime) -
            AirlineSystem.calcDuration(b.departureTime, b.arrivalTime));
          break;
        case 'remaining-desc':
          results.sort((a, b) => b.remaining - a.remaining);
          break;
      }
    }

    return results.map(f => ({
      flightNo: f.flightNo,
      planeNo: f.planeNo,
      origin: f.origin,
      originCode: f.originCode,
      destination: f.destination,
      destCode: f.destCode,
      flightDate: f.flightDate,
      departureTime: f.departureTime,
      arrivalTime: f.arrivalTime,
      duration: AirlineSystem.calcDuration(f.departureTime, f.arrivalTime),
      durationLabel: AirlineSystem.formatDuration(AirlineSystem.calcDuration(f.departureTime, f.arrivalTime)),
      capacity: f.capacity,
      remaining: f.remaining,
      isFull: f.isFull,
      prices: { ...f.prices },
      waitQueueSize: f.waitQueue.size,
    }));
  }

  /** 获取所有始发站/终点站 (用于搜索表单下拉) */
  getAirports() {
    const origins = [...new Set(this.flights.map(f => `${f.origin} (${f.originCode})`))];
    const dests  = [...new Set(this.flights.map(f => `${f.destination} (${f.destCode})`))];
    return { origins, dests };
  }

  /** 获取所有机型 (去重排序) */
  getAircraftTypes() {
    return [...new Set(this.flights.map(f => f.planeNo))].sort();
  }

  /** 获取指定舱位的价格范围 */
  getPriceRange(cabinClass = 3) {
    const prices = this.flights.map(f => f.prices[cabinClass]).filter(p => p > 0);
    if (!prices.length) return { min: 0, max: 0 };
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }

  /** 获取所有可用出发日期 (去重排序) */
  getAvailableDates() {
    return [...new Set(this.flights.filter(f => !f.canceled).map(f => f.flightDate))].sort();
  }

  // ======================== 订票 ========================

  /**
   * 承办订票
   * 流程: 查航班 → 验余票 → 生成PNR+座位 → 插入已订票链表(按姓名有序)
   *
   * @param {string} flightNo      - 航班号
   * @param {string} name          - 客户姓名
   * @param {number} ticketCount   - 订票数量
   * @param {number} cabinClass    - 舱位等级
   * @param {string} passengerType - 旅客类型 adult/child/infant
   * @param {string} contact       - 联系方式
   * @returns {object}
   */
  bookTicket(flightNo, name, ticketCount, cabinClass, passengerType, contact, customSeats, seatCabins) {
    const f = this.findFlight(flightNo);
    if (!f) return { success: false, message: `航班 ${flightNo} 不存在` };
    if (ticketCount <= 0) return { success: false, message: '订票数量必须 > 0' };
    if (f.bookedList.search(name))
      return { success: false, message: `${name} 已在该航班有订票记录, 请使用其他姓名或先退票` };

    if (f.remaining >= ticketCount) {
      const pnr = this._generatePNR();
      // 若提供了手动选座，验证后使用；否则自动分配
      let seats;
      if (customSeats && customSeats.length > 0) {
        if (customSeats.length !== ticketCount)
          return { success: false, message: `选座数量 (${customSeats.length}) 与订票数量 (${ticketCount}) 不匹配` };
        const occupied = f.occupiedSeats();
        for (const s of customSeats) {
          if (occupied.has(s))
            return { success: false, message: `座位 ${s} 已被占用，请重新选择` };
        }
        seats = [...customSeats];
      } else {
        seats = f.generateSeatNumbers(ticketCount, cabinClass);
      }
      const bt = new Date().toLocaleString('zh-CN');
      f.bookedList.insert(name, ticketCount, cabinClass, seats, pnr, bt, passengerType, contact);
      f.remaining -= ticketCount;

      const typeMultiplier = { adult: 1.0, child: 0.75, infant: 0.1 }[passengerType] || 1.0;
      // 跨舱位选座: 按每座实际舱位计价
      let totalPrice, cabinDetail;
      if (seatCabins && customSeats) {
        totalPrice = Math.round(customSeats.reduce((sum, s) => sum + f.getPrice(seatCabins[s] || cabinClass), 0) * typeMultiplier);
        const tally = {};
        for (const c of Object.values(seatCabins)) tally[c] = (tally[c] || 0) + 1;
        const parts = [];
        if (tally[1]) parts.push(`头等×${tally[1]}`);
        if (tally[2]) parts.push(`商务×${tally[2]}`);
        if (tally[3]) parts.push(`经济×${tally[3]}`);
        cabinDetail = parts.join('+');
      } else {
        totalPrice = Math.round(f.getPrice(cabinClass) * ticketCount * typeMultiplier);
        cabinDetail = null;
      }
      this._persist();

      return {
        success: true,
        message: `订票成功! ${name}`,
        name,
        pnr,
        seatNumbers: seats,
        cabinClass,
        cabinName: cabinName(cabinClass),
        cabinDetail,
        ticketCount,
        totalPrice,
        passengerType,
        typeMultiplier,
        currency: 'CNY',
        flightNo,
        origin: f.origin,
        destination: f.destination,
        departureTime: f.departureTime,
        flightDate: f.flightDate,
        bookingTime: bt,
      };
    }

    return {
      success: false,
      message: `余票不足 (剩余 ${f.remaining} 张, 需要 ${ticketCount} 张)`,
      remaining: f.remaining,
      canWaitlist: true,
    };
  }

  /**
   * 加入候补队列
   */
  joinWaitlist(flightNo, name, ticketCount, cabinClass, contact) {
    const f = this.findFlight(flightNo);
    if (!f) return { success: false, message: `航班 ${flightNo} 不存在` };
    const already = f.waitQueue.toArray().find(w => w.name === name);
    if (already) return { success: false, message: `${name} 已在此航班候补队列中` };
    f.waitQueue.enqueue(name, ticketCount, cabinClass, contact);
    this._persist();
    return {
      success: true,
      message: `${name} 已加入候补, 排在队中第 ${f.waitQueue.size} 位`,
      position: f.waitQueue.size,
    };
  }

  // ======================== 退票 ========================

  /**
   * 按姓名退票
   */
  refundTicket(flightNo, name) {
    const f = this.findFlight(flightNo);
    if (!f) return { success: false, message: `航班 ${flightNo} 不存在` };
    const removed = f.bookedList.delete(name);
    if (!removed) return { success: false, message: `${name} 在 ${flightNo} 上无订票记录` };
    return this._processRefund(f, removed);
  }

  /**
   * 按PNR退票 (推荐方式, 参考真实航司)
   */
  refundByPNR(pnr) {
    for (const f of this.flights) {
      const removed = f.bookedList.deleteByPNR(pnr);
      if (removed) return this._processRefund(f, removed);
    }
    return { success: false, message: `PNR ${pnr} 未找到对应订票记录` };
  }

  /**
   * 取消航班 — 一键退票所有已订票旅客 + 清空候补队列
   * @param {string} flightNo - 航班号
   * @returns {object} 包含已退票旅客列表和候补清退列表
   */
  cancelFlight(flightNo) {
    const f = this.findFlight(flightNo);
    if (!f) return { success: false, message: `航班 ${flightNo} 不存在` };
    if (f.canceled) return { success: false, message: `航班 ${flightNo} 已被取消` };

    const refundedPassengers = [];
    const waitlistedPassengers = [];

    // 逐人退票 (不触发候补补位, 因为航班取消了)
    const allBooked = f.bookedList.toArray();
    for (const c of allBooked) {
      const removed = f.bookedList.delete(c.name);
      if (removed) {
        f.remaining += removed.ticketCount;
        refundedPassengers.push({
          name: removed.name,
          ticketCount: removed.ticketCount,
          pnr: removed.pnr,
          cabinClass: removed.cabinClass,
          cabinName: cabinName(removed.cabinClass),
          seatNumbers: removed.seatNumbers || [],
        });
      }
    }

    // 清空候补队列 (不补位)
    const allWait = f.waitQueue.toArray();
    for (const w of allWait) {
      waitlistedPassengers.push({
        name: w.name,
        ticketCount: w.ticketCount,
        cabinClass: w.cabinClass,
        cabinName: cabinName(w.cabinClass),
        contact: w.contact,
      });
    }
    // 重建空队列
    f.waitQueue = new LinkedQueue();

    // 标记航班已取消
    f.canceled = true;
    f.remaining = 0;

    this._persist();

    // 构建快捷退票指引
    const totalRefunded = refundedPassengers.reduce((s, r) => s + r.ticketCount, 0);
    const pnrList = refundedPassengers.map(r => r.pnr);

    return {
      success: true,
      message: `航班 ${flightNo} 已取消，共退票 ${totalRefunded} 张 (${refundedPassengers.length} 位旅客)`,
      flightNo,
      origin: f.origin,
      destination: f.destination,
      flightDate: f.flightDate,
      refundedPassengers,
      waitlistedPassengers,
      totalRefundedTickets: totalRefunded,
      totalRefundedPassengers: refundedPassengers.length,
      totalWaitlisted: waitlistedPassengers.length,
      pnrList,
    };
  }

  /** 按PNR查询订票详情 */
  lookupByPNR(pnr) {
    for (const f of this.flights) {
      const node = f.bookedList.searchByPNR(pnr);
      if (node) {
        return {
          found: true,
          name: node.name,
          flightNo: f.flightNo,
          origin: f.origin,
          destination: f.destination,
          departureTime: f.departureTime,
          flightDate: f.flightDate,
          ticketCount: node.ticketCount,
          cabinClass: node.cabinClass,
          cabinName: cabinName(node.cabinClass),
          seatNumbers: node.seatNumbers,
          pnr: node.pnr,
          bookingTime: node.bookingTime,
          passengerType: node.passengerType,
          contact: node.contact,
          price: Math.round(f.getPrice(node.cabinClass) * node.ticketCount
            * ({ adult: 1.0, child: 0.75, infant: 0.1 }[node.passengerType] || 1.0)),
        };
      }
    }
    return { found: false };
  }

  /**
   * 尝试将候补队列中的乘客补位到空余座位
   * 遍历队头: 需求量 ≤ 余票 → 出队并生成PNR+座位插入已订票链表
   * @param {Flight} flight
   * @returns {Array} 成功补位的乘客列表
   */
  _fulfillWaitlist(flight) {
    const fulfilled = [];
    while (!flight.waitQueue.isEmpty() && flight.remaining > 0) {
      const front = flight.waitQueue.peek();
      if (flight.remaining >= front.ticketCount) {
        flight.waitQueue.dequeue();
        flight.remaining -= front.ticketCount;
        const newPNR = this._generatePNR();
        const seats = flight.generateSeatNumbers(front.ticketCount, front.cabinClass);
        const bt = new Date().toLocaleString('zh-CN');
        flight.bookedList.insert(front.name, front.ticketCount, front.cabinClass, seats,
                                 newPNR, bt, 'adult', front.contact);
        fulfilled.push({
          name: front.name,
          ticketCount: front.ticketCount,
          seatNumbers: seats,
          pnr: newPNR,
        });
      } else {
        break; // 队头需求量超过余票, 保持队列顺序不再继续
      }
    }
    return fulfilled;
  }

  /**
   * 退票核心处理: 释放票额 → 遍历候补队列自动补位
   */
  _processRefund(flight, removedNode) {
    const refunded = removedNode.ticketCount;
    flight.remaining += refunded;
    const pnr = removedNode.pnr;
    const name = removedNode.name;

    const fulfilled = this._fulfillWaitlist(flight);

    this._persist();

    return {
      success: true,
      message: `${name} 退票 ${refunded} 张 (PNR: ${pnr} 已作废)`,
      refundedCount: refunded,
      pnr,
      fulfilled,
    };
  }

  // ======================== 统计 & 持久化 ========================

  stats() {
    let cap = 0, rem = 0, wait = 0;
    for (const f of this.flights) { cap += f.capacity; rem += f.remaining; wait += f.waitQueue.size; }
    return { flightCount: this.flights.length, totalCapacity: cap, totalRemaining: rem,
             totalBooked: cap - rem, totalWait: wait };
  }

  clearAll() {
    this.flights = [];
    localStorage.removeItem('airline_v2_data');
  }

  _persist() {
    try {
      const data = this.flights.map(f => ({
        origin: f.origin, originCode: f.originCode,
        destination: f.destination, destCode: f.destCode,
        flightNo: f.flightNo, planeNo: f.planeNo, flightDate: f.flightDate,
        departureTime: f.departureTime, arrivalTime: f.arrivalTime,
        capacity: f.capacity, prices: f.prices, remaining: f.remaining,
        canceled: f.canceled || false,
        bookedList: f.bookedList.toArray(),
        waitQueue: f.waitQueue.toArray(),
      }));
      localStorage.setItem('airline_v2_data', JSON.stringify(data));
    } catch (e) {
      console.warn('航空订票系统: 数据保存失败，请检查浏览器存储空间', e);
    }
  }

  load() {
    try {
      const raw = localStorage.getItem('airline_v2_data');
      if (!raw) return false;
      const data = JSON.parse(raw);
      this.flights = [];
      for (const d of data) {
        const f = new Flight(d.origin, d.originCode, d.destination, d.destCode,
                             d.flightNo, d.planeNo, d.flightDate,
                             d.departureTime, d.arrivalTime, d.capacity, d.prices);
        f.remaining = d.remaining;
        f.canceled = d.canceled || false;
        for (const c of d.bookedList || [])
          f.bookedList.insert(c.name, c.ticketCount, c.cabinClass, c.seatNumbers || [],
                              c.pnr, c.bookingTime, c.passengerType, c.contact);
        for (const w of d.waitQueue || [])
          f.waitQueue.enqueue(w.name, w.ticketCount, w.cabinClass, w.contact);
        this.flights.push(f);
      }
      // 自动处理候补: 数据恢复后, 有空位就补进去
      for (const f of this.flights) {
        if (f.remaining > 0 && !f.waitQueue.isEmpty()) {
          this._fulfillWaitlist(f);
        }
      }
      return true;
    } catch (e) {
      console.warn('航空订票系统: 数据加载失败，将使用测试数据', e);
      return false;
    }
  }

  initTestData() {
    // ═══════════════════════════════════════════════════════════════
    // 航线录入 — 23条航线 (国内15 + 国际8)
    // ═══════════════════════════════════════════════════════════════

    // —— 国内 · 北京始发 ————————————————————————————————————————
    this.addFlight('北京','PEK','上海','SHA','CA1001','B787-9','2026-06-15','08:00','10:15',220,{1:4280,2:2180,3:680});
    this.addFlight('北京','PEK','上海','SHA','CA1003','A350-9','2026-06-17','09:30','11:45',240,{1:4580,2:2380,3:720});
    this.addFlight('北京','PEK','广州','CAN','CA2001','B777-3','2026-06-16','07:30','10:40',280,{1:5200,2:2680,3:880});
    this.addFlight('北京','PEK','广州','CAN','CA2003','A330-3','2026-06-19','14:00','17:10',260,{1:4980,2:2480,3:820});
    this.addFlight('北京','PEK','深圳','SZX','CA3001','B787-9','2026-06-18','08:30','11:35',200,{1:4680,2:2380,3:760});
    this.addFlight('北京','PEK','成都','CTU','CA4001','A320N','2026-06-20','10:00','12:50',180,{1:3580,2:1780,3:580});
    this.addFlight('北京','PEK','昆明','KMG','CA5001','B737-8','2026-06-24','07:00','10:20',190,{1:3980,2:1980,3:650});
    this.addFlight('北京','PEK','三亚','SYX','CA6001','B787-9','2026-06-26','09:00','12:30',210,{1:5200,2:2680,3:880});

    // —— 国内 · 上海始发 ————————————————————————————————————————
    this.addFlight('上海','SHA','北京','PEK','MU1002','B787-9','2026-06-22','11:30','13:45',220,{1:4280,2:2180,3:680});
    this.addFlight('上海','SHA','广州','CAN','MU2002','A330-3','2026-06-23','09:00','11:15',250,{1:3880,2:1980,3:620});
    this.addFlight('上海','SHA','三亚','SYX','MU3002','B787-9','2026-06-27','08:00','11:10',200,{1:4280,2:2180,3:700});
    this.addFlight('上海','SHA','成都','CTU','MU4002','A320N','2026-06-28','14:00','17:00',180,{1:3680,2:1880,3:590});

    // —— 国内 · 广州始发 ————————————————————————————————————————
    this.addFlight('广州','CAN','北京','PEK','CZ2002','B777-3','2026-06-23','11:30','14:40',280,{1:5200,2:2680,3:880});
    this.addFlight('广州','CAN','上海','SHA','CZ3002','A330-3','2026-06-24','08:00','10:15',250,{1:3880,2:1980,3:620});
    this.addFlight('广州','CAN','三亚','SYX','CZ4002','A320N','2026-06-26','07:30','09:00',160,{1:1980,2:980,3:350});
    this.addFlight('广州','CAN','成都','CTU','CZ5002','B737-8','2026-06-25','09:30','12:00',180,{1:3280,2:1680,3:550});

    // —— 国际 · 亚洲短途 —————————————————————————————————————————
    this.addFlight('北京','PEK','东京','NRT','CA901','B777-3','2026-06-18','08:30','12:50',300,{1:12800,2:6800,3:2800});
    this.addFlight('北京','PEK','首尔','ICN','CA903','A330-3','2026-06-19','10:00','12:10',260,{1:8800,2:4500,3:1800});
    this.addFlight('北京','PEK','曼谷','BKK','CA701','A350-9','2026-06-20','09:00','13:30',300,{1:9800,2:5200,3:2200});
    this.addFlight('上海','SHA','东京','HND','MU501','B787-9','2026-06-21','08:00','11:30',280,{1:13800,2:7200,3:3000});
    this.addFlight('上海','SHA','新加坡','SIN','MU567','A350-9','2026-06-22','10:00','15:30',290,{1:11800,2:6200,3:2600});

    // —— 国际 · 长途 —————————————————————————————————————————————
    this.addFlight('北京','PEK','伦敦','LHR','CA851','B787-9','2026-06-20','11:00','15:30',280,{1:48000,2:25000,3:8500});
    this.addFlight('北京','PEK','迪拜','DXB','CA981','A350-9','2026-06-22','13:00','18:00',300,{1:32000,2:16800,3:6200});
    this.addFlight('北京','PEK','悉尼','SYD','CA175','B787-9','2026-06-25','15:00','08:30',280,{1:52000,2:28000,3:9500});

    // ═══════════════════════════════════════════════════════════════
    // 订票 & 候补辅助函数
    // ═══════════════════════════════════════════════════════════════

    let pnrSeq = 0;
    const np = () => { pnrSeq++; return `T${String(pnrSeq).padStart(5,'0')}`; };

    // 姓名生成池 (组合出不同姓名)
    const SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁'.split('');
    const GIVENS  = '伟国志建明文秀丽华海燕卫东永强春梅玉兰晓峰艳红志强雪莲桂英建国丽芬文博俊杰秋菊志豪晓燕秀芳永辉春兰海波'.match(/../g);

    /** 按目标人数自动填充航班 (用于高密度 & 满员航班) */
    const fillFlight = (flightNo, targetBooked) => {
      const f = this.findFlight(flightNo);
      if (!f) return;
      let booked = 0, idx = 0;
      while (booked < targetBooked) {
        const remain = targetBooked - booked;
        // 最后剩余不足4人时一次订完; 否则随机 1-4 人一组
        const n = remain <= 4 ? remain : (idx % 4) + 1;
        const name = SURNAMES[idx % SURNAMES.length] + GIVENS[idx % GIVENS.length];
        const cabin = (booked + n <= 4) ? 1 : ((idx % 8 === 0) ? 2 : 3); // 前4位头等, 隔8位商务
        f.bookedList.insert(name, n, cabin, f.generateSeatNumbers(n, cabin),
          np(), `2026-06-0${8 + (idx % 12)} 10:00:00`, 'adult', '');
        booked += n;
        idx++;
      }
      f.remaining = f.capacity - targetBooked;
    };

    /** 添加候补 */
    const addWait = (flightNo, list) => {
      const f = this.findFlight(flightNo);
      if (!f) return;
      for (const w of list) f.waitQueue.enqueue(w.name, w.n, w.cabin, w.tel);
    };

    // ═══════════════════════════════════════════════════════════════
    // 订票数据 — fillFlight(航班号, 目标订票数)
    //   6条满员+候补 / 8条高密度(85-95%) / 10条中等(65-80%)
    // ═══════════════════════════════════════════════════════════════

    // —— 国内 · 北京始发 ————————————————————————————————————————
    fillFlight('CA1001', 198);  // 220座 90%
    fillFlight('CA1003', 210);  // 240座 88%
    fillFlight('CA2001', 280);  // 280座 🔴满员
    fillFlight('CA2003', 221);  // 260座 85%
    fillFlight('CA3001', 150);  // 200座 75%
    fillFlight('CA4001', 135);  // 180座 75%
    fillFlight('CA5001', 133);  // 190座 70%
    fillFlight('CA6001', 210);  // 210座 🔴满员

    // —— 国内 · 上海始发 ————————————————————————————————————————
    fillFlight('MU1002', 192);  // 220座 87%
    fillFlight('MU2002', 188);  // 250座 75%
    fillFlight('MU3002', 200);  // 200座 🔴满员
    fillFlight('MU4002', 130);  // 180座 72%

    // —— 国内 · 广州始发 ————————————————————————————————————————
    fillFlight('CZ2002', 238);  // 280座 85%
    fillFlight('CZ3002', 190);  // 250座 76%
    fillFlight('CZ4002', 118);  // 160座 74%
    fillFlight('CZ5002', 126);  // 180座 70%

    // —— 国际 · 亚洲短途 —————————————————————————————————————————
    fillFlight('CA901',  300);  // 300座 🔴满员
    fillFlight('CA903',  200);  // 260座 77%
    fillFlight('CA701',  264);  // 300座 88%
    fillFlight('MU501',  280);  // 280座 🔴满员
    fillFlight('MU567',  240);  // 290座 83%

    // —— 国际 · 长途 —————————————————————————————————————————————
    fillFlight('CA851',  280);  // 280座 🔴满员
    fillFlight('CA981',  261);  // 300座 87%
    fillFlight('CA175',  215);  // 280座 77%

    // ═══════════════════════════════════════════════════════════════
    // 候补数据 (仅满员航班)
    // ═══════════════════════════════════════════════════════════════
    addWait('CA2001', [
      {name:'刘鹏飞', n:2, cabin:3, tel:'138****1234'},
      {name:'陈雨桐', n:1, cabin:2, tel:'139****5678'},
      {name:'赵明轩', n:3, cabin:3, tel:'136****9012'},
    ]);
    addWait('CA6001', [
      {name:'王思远', n:2, cabin:3, tel:'137****3456'},
      {name:'李雨桐', n:1, cabin:2, tel:'135****7890'},
      {name:'张浩然', n:3, cabin:3, tel:'133****2345'},
      {name:'刘梓涵', n:2, cabin:3, tel:'131****6789'},
    ]);
    addWait('MU3002', [
      {name:'陈雨桐', n:1, cabin:2, tel:'139****1111'},
      {name:'赵明轩', n:2, cabin:3, tel:'136****2222'},
      {name:'刘梓涵', n:3, cabin:3, tel:'133****3333'},
    ]);
    addWait('CA901', [
      {name:'周子轩', n:2, cabin:2, tel:'138****8001'},
      {name:'吴雨桐', n:1, cabin:1, tel:'139****8002'},
      {name:'郑浩然', n:3, cabin:2, tel:'136****8003'},
      {name:'王梓涵', n:2, cabin:3, tel:'135****8004'},
    ]);
    addWait('MU501', [
      {name:'陈思远', n:1, cabin:2, tel:'139****9001'},
      {name:'赵雨桐', n:2, cabin:3, tel:'136****9002'},
      {name:'刘明轩', n:3, cabin:3, tel:'133****9003'},
    ]);
    addWait('CA851', [
      {name:'王思远', n:2, cabin:2, tel:'138****7001'},
      {name:'李浩然', n:1, cabin:1, tel:'139****7002'},
    ]);

    // ═══════════════════════════════════════════════════════════════
    // 自动补位: 有空位且候补非空 → 补进去 (确保数据合理)
    // ═══════════════════════════════════════════════════════════════
    for (const f of this.flights) {
      if (f.remaining > 0 && !f.waitQueue.isEmpty()) {
        this._fulfillWaitlist(f);
      }
    }
    this._persist();
  }
}
function cabinName(c) { return ['','头等舱','商务舱','经济舱'][c] || '经济舱'; }
