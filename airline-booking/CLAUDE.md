# SkyLine 航空客运订票系统 — 项目文档

> **最后更新**: 2026-06-16 | **版本**: v2.2 | **总行数**: ~2,200

---

## 项目概述

**课程作业**: 航空客运订票系统的网页实现。核心要求是实现航线查询、客票预订(含候补队列)、退票(自动候补补位)，使用特定数据结构：顺序表存航线、排序链表存已订票客户、链式队列存候补名单。

**技术栈**: 纯前端 (HTML + CSS + vanilla JS)，零依赖，`localStorage` 做数据持久化。直接在浏览器中打开 `index.html` 即可运行。

---

## 文件结构与职责

```
airline-booking/
├── index.html               (259 行) — 页面骨架，5 个 Tab 分页
├── css/
│   └── style.css            (549 行) — Premium 航司主题样式
└── js/
    ├── data-structures.js   (250 行) — 基础数据结构 (无业务逻辑)
    ├── airline-system.js    (528 行) — 核心业务层 (Flight + AirlineSystem)
    └── app.js               (738 行) — UI 交互层 (DOM 操作、事件绑定)
```

### 依赖顺序 (严格)

```
data-structures.js → airline-system.js → app.js
     (无依赖)          (依赖前者)        (依赖前两者)
```

`index.html` 中 `<script>` 标签按此顺序加载。所有类挂载在全局 `window` 上。

---

## 数据结构设计

### 1. 航线汇总表 — 顺序存储 (数组 `AirlineSystem.flights`)

按**航班号**升序排列。每次 `addFlight()` 使用 `findIndex` + `splice` 维持有序性。查找用顺序搜索 (航线数少，无需二分)。

### 2. 已订票客户名单 — `SortedLinkedList` (按姓名排序的单链表)

- 节点: `CustomerNode` — name, ticketCount, cabinClass, seatNumbers[], pnr, bookingTime, passengerType, contact, next
- 插入 (`insert`): 遍历找位置，`localeCompare(name, 'zh')` 做中文排序
- 查找: `search(name)` 按姓名，`searchByPNR(pnr)` 按 PNR
- 删除: `delete(name)` 按姓名，`deleteByPNR(pnr)` 按 PNR
- 遍历: `toArray()` 返回纯数据数组 (给序列化/UI用)

### 3. 候补客户名单 — `LinkedQueue` (链式队列，FIFO)

- 节点: `WaitNode` — name, ticketCount, cabinClass, contact, enqueueTime, next
- `front` 队头指针 / `rear` 队尾指针
- `enqueue()` 队尾追加，`dequeue()` 队头移除
- `peek()` 查看队头不移除，`removeByName()` 按姓名移除

### 数据结构对应关系

| 需求描述 | 实现 | 存储结构 |
|---------|------|---------|
| 航线汇总表 | `AirlineSystem.flights` (Array) | 顺序存储，按航班号有序 |
| 已订票客户名单 | `Flight.bookedList` (SortedLinkedList) | 按姓名排序的链表 |
| 等候替补客户名单 | `Flight.waitQueue` (LinkedQueue) | 链式队列，front/rear 指针 |
| 每条航线8个信息域 | `Flight` 类属性 | 含指向两个链式结构的指针 |

---

## 核心业务逻辑 (`airline-system.js`)

### Flight 类

```
属性: origin, originCode, destination, destCode, flightNo, planeNo,
      flightDate, departureTime, arrivalTime, capacity, prices{1,2,3}, remaining
链表: bookedList (SortedLinkedList), waitQueue (LinkedQueue)
方法: generateSeatNumbers(count), occupiedSeats(), getSeatMap(), getPrice(cabinClass)
```

### AirlineSystem 类

| 方法 | 功能 |
|------|------|
| `addFlight(...)` | 录入航班，按航班号有序插入 |
| `findFlight(flightNo)` | 按航班号查找 |
| `searchFlights(origin, dest, date?)` | 按航线+日期搜索，返回含票价/余票的列表 |
| `queryByDestination(dest)` | 按终点站模糊查询 |
| `bookTicket(flightNo, name, count, cabin, paxType, contact)` | 订票核心: 查余票→生成PNR→分配座位→插入链表 |
| `joinWaitlist(flightNo, name, count, cabin, contact)` | 加入候补队列 |
| `refundTicket(flightNo, name)` | 按姓名退票→释放票额→遍历候补队列自动补位 |
| `refundByPNR(pnr)` | 按PNR退票 (推荐方式) |
| `lookupByPNR(pnr)` | PNR查询订单详情 |
| `getSeatMap()` | 返回分区座位图数据 (头等/商务/经济) |
| `getAirports()` | 获取所有始发站/终点站列表 |
| `stats()` | 统计: 航线数/总运力/已售/剩余/候补人数 |
| `load()` / `_persist()` | localStorage 持久化 (`airline_v2_data` 键) |
| `initTestData()` | 初始化18条测试航线 |
| `clearAll()` | 清空数据 |

### PNR 生成

- 6位字母+数字，字符集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (排除 I/O/0/1)
- 循环检查全局唯一性

### 座位编号规则

每排6座 (A-F)，顺序编号: 第N张票 = `ceil(N/6)` 排 + `(N-1)%6` 列字母。

### 座舱分区 (v2.1)

```
头等舱: 第 1-2 排, 1-2-1 布局 (A, C | aisle | D, F)
商务舱: 第 3-5 排, 2-2 布局
经济舱: 第 6+ 排,  3-3 布局 (A,B,C | aisle | D,E,F)
紧急出口: 经济舱第1排 + 第11排
```

### 退票候补处理逻辑

```
1. 从 bookedList 删除客户 → 释放票额
2. while (候补队列非空 && 可用票 > 0):
     peek 队头 → 需求量 ≤ 可用票? 
       是 → dequeue → 生成PNR → 插入 bookedList
       否 → break (保持队列顺序)
```

### localStorage 序列化

- 键名: `"airline_v2_data"`
- `toArray()` 将链表/队列转为纯数组 → `JSON.stringify`
- `load()` 时逆向重建所有链表/队列结构

---

## UI 设计 (`index.html` + `app.js` + `style.css`)

### 5 个 Tab 页面

| Tab | ID | 功能 |
|-----|-----|------|
| 航班总览 | `tab-overview` | Hero 快捷搜索 + 全部航线表(可展开行) |
| 搜索航班 | `tab-search` | 高级搜索: 始发→终点+日期过滤 |
| 预订客票 | `tab-book` | 3步流程: 选航班→填信息+选座→PNR确认 |
| 订单管理 | `tab-manage` | PNR查询/退票 + 按姓名退票 + 候补查看 |
| 录入航班 | `tab-add` | 完整航班表单(含票价、机场代码) |

### Tab 切换机制

`data-tab` 属性关联按钮与内容区，`switchTab(tabId)` 函数支持编程式跳转。

### 订票3步流程

1. 下拉选航班 → 点击"确认选择" → 解锁步骤2
2. 填姓名/类型/数量/舱位/联系方式 + 可视化选座 → 点击"确认预订"
3. 显示 PNR 确认卡 (金色虚线边框，模拟登机牌)

### 座位图渲染 (v2.1)

- `.fuselage` 机身外框 (CSS border-radius 模拟机头/机尾)
- `.cabin-zone` 三级分区 (金色头等/蓝灰商务/绿色经济)
- `.seat` 梯形座椅造型 + 3D渐变 + hover弹起动画
- 紧急出口排: 橙色 EXIT 标记 + 背景高亮
- Tooltip 显示座位号·舱位名称·票价
- 实时价格摘要栏 (`#seat-price-summary`)

### 设计语言

参考阿联酋/卡塔尔/新加坡航空:
- 主色: `#0d1b2a` (午夜蓝), 强调色: `#c8963e` (香槟金)
- Sticky header + tab bar
- Hero 搜索区使用深色渐变背景
- 卡片白色 + subtle shadow
- 16px 圆角, cubic-bezier 过渡

---

## 运行方式

```bash
# 直接双击打开
open index.html

# 或使用任意 HTTP 服务器
python3 -m http.server 8000
```

数据自动保存在浏览器 `localStorage` 的 `airline_v2_data` 键中。

---

## 当前状态 & 已知限制

### 已实现 ✅
- 全部4项基本要求 (录入/查询/订票/退票)
- 退票自动处理候补队列
- PNR 生成与查找
- 可视化座位图 (含舱位分区)
- 测试数据 (18条航线)
- localStorage 持久化

### 已知限制 ⚠️
- **仅支持单程**: 无往返/多程搜索
- **未实现文件存储**: 题目要求"最好存储在文件中"，目前仅 localStorage
- **无后端**: 所有数据仅存浏览器，多设备不同步
- **候补队列策略简化**: 不能满足队头就停止，未实现部分满足+继续下一人

### 未来可优化 📋
- [ ] 往返/多程搜索
- [ ] 导出/导入数据为 JSON 文件 (替代 localStorage)
- [ ] 航司 Logo、真实的机场三字码数据
- [ ] 响应式移动端优化 (当前基础支持)
- [ ] 单元测试

---

## 关键实现细节 (给后续开发者)

### 在 HTML 中新增元素时
- 所有可交互元素必须在 JS 中有对应的 `$('#id')` 引用
- 数据列表 (datalist) 的 ID 是 `airport-list`
- Toast 容器 ID 是 `toast-container`

### 修改数据结构时
- `CustomerNode` / `WaitNode` 的字段变更需要同步更新:
  - `toArray()` (序列化输出)
  - `_persist()` / `load()` (JSON 序列化/反序列化)
  - 所有 `new CustomerNode(...)` / `new WaitNode(...)` 调用处
- 变更后旧 `airline_v2_data` 会失效 → 需清空或写迁移逻辑

### 新增航班字段时
- `_persist()` 和 `load()` 需同步
- `initTestData()` 的 `addFlight()` 调用需更新参数

### CSS 命名约定
- 组件用 `kebab-case` (如 `.hero-search`, `.pnr-card`)
- 状态用 SMACSS 风格 (`.seat.available`, `.badge.badge-success`)
- 颜色统一使用 CSS 变量 (`var(--primary)` 等)

### JS 命名约定
- 业务层方法: `camelCase` (如 `bookTicket`, `searchFlights`)
- 私有方法: `_` 前缀 (如 `_persist`, `_nearestDate`)
- UI 层函数: 全局 `function` (如 `doBook`, `renderSeatMap`)
- 工具函数: `$()` = `document.querySelector`, `esc()` = HTML 转义

### 此项目不可做的事
- ❌ 不要引入 npm 依赖或构建工具 — 保持纯浏览器可运行
- ❌ 不要改变 localStorage 键名 (`airline_v2_data`) — 除非写迁移脚本
- ❌ 不要改变 `<script>` 加载顺序 — 有严格依赖关系
