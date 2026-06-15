/**
 * 航空客运订票系统 - 基础数据结构 (v2.0)
 *
 * 包含:
 *   - CustomerNode     : 已订票客户链表节点 (含PNR、订票时间、旅客类型)
 *   - SortedLinkedList : 按姓名排序的链表 (已订票客户名单)
 *   - WaitNode         : 候补客户队列节点 (含舱位偏好)
 *   - LinkedQueue      : 链式队列 (等候替补客户名单)
 *
 * 设计说明:
 *   已订票客户名单使用按姓名有序的链表 —— 支持按姓名和PNR双重查找
 *   等候替补客户名单使用链式队列 —— 先进先出, 人数无上限
 *   PNR编号参考阿联酋航空: 6位大写字母+数字混合
 */

// ==================== 已订票客户链表 ====================

class CustomerNode {
  /**
   * @param {string}   name         - 客户姓名
   * @param {number}   ticketCount  - 订票数量
   * @param {number}   cabinClass   - 舱位等级 (1-头等舱 / 2-商务舱 / 3-经济舱)
   * @param {string[]} seatNumbers  - 分配的座位号数组
   * @param {string}   pnr          - 订票参考号 (Passenger Name Record)
   * @param {string}   bookingTime  - 订票时间
   * @param {string}   passengerType - 旅客类型: adult/child/infant
   * @param {string}   contact      - 联系方式 (手机号或邮箱)
   */
  constructor(name, ticketCount, cabinClass, seatNumbers, pnr, bookingTime, passengerType, contact) {
    this.name = name;
    this.ticketCount = ticketCount;
    this.cabinClass = cabinClass;
    this.seatNumbers = seatNumbers;
    this.pnr = pnr;
    this.bookingTime = bookingTime;
    this.passengerType = passengerType || 'adult';
    this.contact = contact || '';
    /** @type {CustomerNode|null} */
    this.next = null;
  }
}

class SortedLinkedList {
  constructor() {
    /** @type {CustomerNode|null} 头指针 */
    this.head = null;
    this._size = 0;
  }

  get size() { return this._size; }

  insert(name, ticketCount, cabinClass, seatNumbers, pnr, bookingTime, passengerType, contact) {
    const node = new CustomerNode(name, ticketCount, cabinClass, seatNumbers, pnr, bookingTime, passengerType, contact);
    this._size++;

    if (!this.head || this.head.name.localeCompare(name, 'zh') > 0) {
      node.next = this.head;
      this.head = node;
      return;
    }
    let cur = this.head;
    while (cur.next && cur.next.name.localeCompare(name, 'zh') <= 0) {
      cur = cur.next;
    }
    node.next = cur.next;
    cur.next = node;
  }

  delete(name) {
    if (!this.head) return null;
    if (this.head.name === name) {
      const removed = this.head;
      this.head = this.head.next;
      this._size--;
      return removed;
    }
    let cur = this.head;
    while (cur.next && cur.next.name !== name) {
      cur = cur.next;
    }
    if (cur.next) {
      const removed = cur.next;
      cur.next = cur.next.next;
      this._size--;
      return removed;
    }
    return null;
  }

  /**
   * 按PNR查找客户 (新增)
   * @param {string} pnr
   * @returns {CustomerNode|null}
   */
  searchByPNR(pnr) {
    let cur = this.head;
    while (cur) {
      if (cur.pnr === pnr) return cur;
      cur = cur.next;
    }
    return null;
  }

  search(name) {
    let cur = this.head;
    while (cur) {
      if (cur.name === name) return cur;
      cur = cur.next;
    }
    return null;
  }

  /** 删除指定PNR的客户 (用于退票) */
  deleteByPNR(pnr) {
    if (!this.head) return null;
    if (this.head.pnr === pnr) {
      const removed = this.head;
      this.head = this.head.next;
      this._size--;
      return removed;
    }
    let cur = this.head;
    while (cur.next && cur.next.pnr !== pnr) {
      cur = cur.next;
    }
    if (cur.next) {
      const removed = cur.next;
      cur.next = cur.next.next;
      this._size--;
      return removed;
    }
    return null;
  }

  toArray() {
    const arr = [];
    let cur = this.head;
    while (cur) {
      arr.push({
        name: cur.name,
        ticketCount: cur.ticketCount,
        cabinClass: cur.cabinClass,
        seatNumbers: cur.seatNumbers,
        pnr: cur.pnr,
        bookingTime: cur.bookingTime,
        passengerType: cur.passengerType,
        contact: cur.contact,
      });
      cur = cur.next;
    }
    return arr;
  }

  getTotalBooked() {
    let total = 0;
    let cur = this.head;
    while (cur) { total += cur.ticketCount; cur = cur.next; }
    return total;
  }
}

// ==================== 候补客户队列 ====================

class WaitNode {
  /**
   * @param {string} name         - 客户姓名
   * @param {number} ticketCount  - 所需票量
   * @param {number} cabinClass   - 舱位偏好 (1/2/3)
   * @param {string} contact      - 联系方式
   */
  constructor(name, ticketCount, cabinClass, contact) {
    this.name = name;
    this.ticketCount = ticketCount;
    this.cabinClass = cabinClass || 3;
    this.contact = contact || '';
    /** @type {WaitNode|null} */
    this.next = null;
    this.enqueueTime = new Date().toLocaleString('zh-CN'); // 入队时间
  }
}

class LinkedQueue {
  constructor() {
    /** @type {WaitNode|null} 队头指针 */
    this.front = null;
    /** @type {WaitNode|null} 队尾指针 */
    this.rear = null;
    this._size = 0;
  }

  get size() { return this._size; }

  enqueue(name, ticketCount, cabinClass, contact) {
    const node = new WaitNode(name, ticketCount, cabinClass, contact);
    if (!this.rear) {
      this.front = this.rear = node;
    } else {
      this.rear.next = node;
      this.rear = node;
    }
    this._size++;
  }

  /** 按姓名+联系方式移除候补 */
  removeByName(name) {
    if (!this.front) return null;
    if (this.front.name === name) return this.dequeue();
    let cur = this.front;
    while (cur.next && cur.next.name !== name) {
      cur = cur.next;
    }
    if (cur.next) {
      const removed = cur.next;
      cur.next = cur.next.next;
      if (!cur.next) this.rear = cur;
      this._size--;
      return removed;
    }
    return null;
  }

  dequeue() {
    if (!this.front) return null;
    const removed = this.front;
    this.front = this.front.next;
    if (!this.front) this.rear = null;
    this._size--;
    return removed;
  }

  peek() { return this.front; }
  isEmpty() { return !this.front; }

  toArray() {
    const arr = [];
    let cur = this.front, pos = 1;
    while (cur) {
      arr.push({
        position: pos++,
        name: cur.name,
        ticketCount: cur.ticketCount,
        cabinClass: cur.cabinClass,
        contact: cur.contact,
        enqueueTime: cur.enqueueTime,
      });
      cur = cur.next;
    }
    return arr;
  }
}
