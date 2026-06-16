/**
 * 航空客运订票系统 — 核心业务逻辑 (v2.0)
 *
 * 参考阿联酋航空等主流航司的业务模型:
 *   - 每条航线含始发站/终点站 (三字码)、起飞/到达时刻、各舱位票价
 *   - 订票生成 6 位 PNR 参考号, 记录订票时间和旅客类型
 *   - 退票支持按姓名或PNR查找, 自动触发候补队列处理
 *   - 座位管理: 每排6座(A-F), 可视化座位图
 *
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
  }

  get bookedCount() { return this.bookedList.getTotalBooked(); }
  get isFull() { return this.remaining <= 0; }

  /** 根据已售票数生成座位号 (每排6座 A-F) */
  generateSeatNumbers(count) {
    const L = ['A','B','C','D','E','F'];
    const seats = [];
    const start = this.bookedCount + 1;
    for (let i = 0; i < count; i++) {
      const n = start + i;
      seats.push(`${Math.ceil(n / 6)}${L[(n - 1) % 6]}`);
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
   * 按始发站→终点站搜索航班 (主搜索入口)
   * @param {string} origin      - 始发站 (模糊匹配)
   * @param {string} destination - 终点站 (模糊匹配)
   * @param {string} dateStr     - 期望日期 "YYYY-MM-DD" (可选)
   */
  searchFlights(origin, destination, dateStr) {
    let results = this.flights.filter(f =>
      f.origin.includes(origin) && f.destination.includes(destination)
    );

    // 如果指定日期, 直接按飞行日期过滤
    if (dateStr) {
      const exact = results.filter(f => f.flightDate === dateStr);
      if (exact.length > 0) results = exact; // 优先匹配同日航班
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

  // ======================== 订票 ========================

  /**
   * 承办订票 (增强版)
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
        seats = f.generateSeatNumbers(ticketCount);
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
   * 退票核心处理: 释放票额 → 遍历候补队列自动补位
   */
  _processRefund(flight, removedNode) {
    const refunded = removedNode.ticketCount;
    flight.remaining += refunded;
    const pnr = removedNode.pnr;
    const name = removedNode.name;

    const fulfilled = [];
    let available = flight.remaining;

    while (!flight.waitQueue.isEmpty() && available > 0) {
      const front = flight.waitQueue.peek();
      if (available >= front.ticketCount) {
        flight.waitQueue.dequeue();
        available -= front.ticketCount;
        const newPNR = this._generatePNR();
        const seats = flight.generateSeatNumbers(front.ticketCount);
        const bt = new Date().toLocaleString('zh-CN');
        flight.bookedList.insert(front.name, front.ticketCount, front.cabinClass, seats,
                                 newPNR, bt, 'adult', front.contact);
        flight.remaining = available;
        fulfilled.push({
          name: front.name,
          ticketCount: front.ticketCount,
          seatNumbers: seats,
          pnr: newPNR,
        });
      } else {
        break;
      }
    }

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
        bookedList: f.bookedList.toArray(),
        waitQueue: f.waitQueue.toArray(),
      }));
      localStorage.setItem('airline_v2_data', JSON.stringify(data));
    } catch (_) {}
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
        for (const c of d.bookedList || [])
          f.bookedList.insert(c.name, c.ticketCount, c.cabinClass, c.seatNumbers || [],
                              c.pnr, c.bookingTime, c.passengerType, c.contact);
        for (const w of d.waitQueue || [])
          f.waitQueue.enqueue(w.name, w.ticketCount, w.cabinClass, w.contact);
        this.flights.push(f);
      }
      return true;
    } catch (_) { return false; }
  }

  initTestData() {
    // 北京始发
    this.addFlight('北京','PEK','上海','SHA','CA1001','B787-9','2026-06-15','08:00','10:15',220,{1:4280,2:2180,3:680});
    this.addFlight('北京','PEK','上海','SHA','CA1003','A350-9','2026-06-17','09:30','11:45',240,{1:4580,2:2380,3:720});
    this.addFlight('北京','PEK','广州','CAN','CA2001','B777-3','2026-06-16','07:30','10:40',280,{1:5200,2:2680,3:880});
    this.addFlight('北京','PEK','广州','CAN','CA2003','A330-3','2026-06-19','14:00','17:10',260,{1:4980,2:2480,3:820});
    this.addFlight('北京','PEK','深圳','SZX','CA3001','B787-9','2026-06-18','08:30','11:35',200,{1:4680,2:2380,3:760});
    this.addFlight('北京','PEK','成都','CTU','CA4001','A320N','2026-06-20','10:00','12:50',180,{1:3580,2:1780,3:580});
    this.addFlight('北京','PEK','昆明','KMG','CA5001','B737-8','2026-06-24','07:00','10:20',190,{1:3980,2:1980,3:650});
    this.addFlight('北京','PEK','三亚','SYX','CA6001','B787-9','2026-06-26','09:00','12:30',210,{1:5200,2:2680,3:880});

    // 上海始发
    this.addFlight('上海','SHA','北京','PEK','MU1002','B787-9','2026-06-22','11:30','13:45',220,{1:4280,2:2180,3:680});
    this.addFlight('上海','SHA','北京','PEK','MU1004','A350-9','2026-06-25','16:00','18:15',240,{1:4580,2:2380,3:720});
    this.addFlight('上海','SHA','广州','CAN','MU2002','A330-3','2026-06-23','09:00','11:15',250,{1:3880,2:1980,3:620});
    this.addFlight('上海','SHA','三亚','SYX','MU3002','B787-9','2026-06-27','08:00','11:10',200,{1:4280,2:2180,3:700});
    this.addFlight('上海','SHA','成都','CTU','MU4002','A320N','2026-06-28','14:00','17:00',180,{1:3680,2:1880,3:590});

    // 广州始发
    this.addFlight('广州','CAN','北京','PEK','CZ2002','B777-3','2026-06-23','11:30','14:40',280,{1:5200,2:2680,3:880});
    this.addFlight('广州','CAN','上海','SHA','CZ3002','A330-3','2026-06-24','08:00','10:15',250,{1:3880,2:1980,3:620});
    this.addFlight('广州','CAN','三亚','SYX','CZ4002','A320N','2026-06-26','07:30','09:00',160,{1:1980,2:980,3:350});
    this.addFlight('广州','CAN','成都','CTU','CZ5002','B737-8','2026-06-25','09:30','12:00',180,{1:3280,2:1680,3:550});

    // 预置订票数据 (含PNR)
    const f1 = this.findFlight('CA1001');
    if (f1) {
      f1.bookedList.insert('张三', 2, 1, ['1A','1B'], 'AB3KX9', '2026-06-10 09:30:00', 'adult', '138****6789');
      f1.bookedList.insert('李四', 3, 2, ['1C','1D','1E'], 'CD7MP2', '2026-06-11 14:20:00', 'adult', '139****8901');
      f1.bookedList.insert('王五', 1, 3, ['1F'], 'EF2NW5', '2026-06-12 10:15:00', 'adult', '136****0123');
      f1.remaining = f1.capacity - 6;
      f1.waitQueue.enqueue('赵六', 2, 3, '137****4567');
      f1.waitQueue.enqueue('孙七', 1, 1, '135****7890');
    }
    const f2 = this.findFlight('CA2001');
    if (f2) {
      f2.bookedList.insert('周八', 2, 2, ['1A','1B'], 'GH4RT6', '2026-06-08 08:00:00', 'adult', '133****5555');
      f2.remaining = f2.capacity - 2;
    }
    this._persist();
  }
}

// 共用工具函数
function cabinName(c) { return ['','头等舱','商务舱','经济舱'][c] || '经济舱'; }
