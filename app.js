const storageKey = "zfl16-movable-type-workshop";

const starterInventory = [
  { id: crypto.randomUUID(), char: "山", style: "宋体旧字", size: 30, quantity: 4, wear: "微磨" },
  { id: crypto.randomUUID(), char: "月", style: "宋体旧字", size: 30, quantity: 3, wear: "旧痕" },
  { id: crypto.randomUUID(), char: "风", style: "楷体木刻", size: 28, quantity: 2, wear: "微磨" },
  { id: crypto.randomUUID(), char: "花", style: "楷体木刻", size: 28, quantity: 2, wear: "新" },
  { id: crypto.randomUUID(), char: "茶", style: "黑体铅字", size: 24, quantity: 3, wear: "旧痕" },
  { id: crypto.randomUUID(), char: "雨", style: "仿宋细字", size: 22, quantity: 4, wear: "新" }
];

const ORDER_STATUS = {
  pending: { label: "待排版", chip: "gold", next: ["making"] },
  making: { label: "制作中", chip: "blue", next: ["done", "pending"] },
  done: { label: "已完成", chip: "green", next: ["rework"] },
  rework: { label: "返工", chip: "red", next: ["making"] }
};

const PRIORITIES = {
  high: { label: "高", weight: 3 },
  medium: { label: "中", weight: 2 },
  low: { label: "低", weight: 1 }
};

const PAPER_LABELS = { postcard: "明信片", bookmark: "书签", square: "方形小笺" };
const FLOW_LABELS = { horizontal: "横排", vertical: "竖排" };

const defaultState = {
  inventory: starterInventory,
  selectedTypeId: starterInventory[0].id,
  placements: [],
  drafts: [],
  orders: [],
  replans: [],
  selectedOrderId: null,
  view: "editor",
  settings: {
    paperSize: "postcard",
    flowMode: "horizontal",
    gridGap: 8,
    workTitle: "晚风小笺"
  }
};

let state = loadState();

const els = {
  paperSize: document.querySelector("#paperSize"),
  flowMode: document.querySelector("#flowMode"),
  gridGap: document.querySelector("#gridGap"),
  workTitle: document.querySelector("#workTitle"),
  stage: document.querySelector("#stage"),
  typeList: document.querySelector("#typeList"),
  typeForm: document.querySelector("#typeForm"),
  charInput: document.querySelector("#charInput"),
  styleInput: document.querySelector("#styleInput"),
  sizeInput: document.querySelector("#sizeInput"),
  quantityInput: document.querySelector("#quantityInput"),
  wearInput: document.querySelector("#wearInput"),
  inventorySearch: document.querySelector("#inventorySearch"),
  styleFilter: document.querySelector("#styleFilter"),
  selectedTypeLabel: document.querySelector("#selectedTypeLabel"),
  shortageBadge: document.querySelector("#shortageBadge"),
  usageList: document.querySelector("#usageList"),
  draftList: document.querySelector("#draftList"),
  placedCount: document.querySelector("#placedCount"),
  inventoryCount: document.querySelector("#inventoryCount"),
  saveDraftBtn: document.querySelector("#saveDraftBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  clearBoardBtn: document.querySelector("#clearBoardBtn"),
  editorTab: document.querySelector("#editorTab"),
  ordersTab: document.querySelector("#ordersTab"),
  orderTabBadge: document.querySelector("#orderTabBadge"),
  editorActions: document.querySelector("#editorActions"),
  editorView: document.querySelector("#editorView"),
  ordersView: document.querySelector("#ordersView"),
  orderForm: document.querySelector("#orderForm"),
  orderTitle: document.querySelector("#orderTitle"),
  orderDue: document.querySelector("#orderDue"),
  orderPriority: document.querySelector("#orderPriority"),
  orderPaper: document.querySelector("#orderPaper"),
  orderFlow: document.querySelector("#orderFlow"),
  orderText: document.querySelector("#orderText"),
  orderCount: document.querySelector("#orderCount"),
  orderList: document.querySelector("#orderList"),
  orderDetail: document.querySelector("#orderDetail"),
  replanNowBtn: document.querySelector("#replanNowBtn"),
  undoReplanBtn: document.querySelector("#undoReplanBtn"),
  replanLog: document.querySelector("#replanLog"),
  toast: document.querySelector("#toast")
};

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return structuredClone(defaultState);
  try {
    const parsed = JSON.parse(saved);
    const merged = {
      ...structuredClone(defaultState),
      ...parsed,
      settings: { ...defaultState.settings, ...parsed.settings }
    };
    merged.orders = (Array.isArray(parsed.orders) ? parsed.orders : []).map((order) => ({
      allocations: {},
      history: [],
      priority: "medium",
      ...order
    }));
    merged.replans = Array.isArray(parsed.replans) ? parsed.replans : [];
    return merged;
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

let toastTimer = null;
function notify(message, type = "info") {
  els.toast.textContent = message;
  els.toast.className = `toast ${type}`;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function getGrid() {
  const size = state.settings.paperSize;
  if (size === "bookmark") return { cols: 7, rows: 18 };
  if (size === "square") return { cols: 12, rows: 12 };
  return { cols: 16, rows: 10 };
}

function placementKey(row, col) {
  return `${row}:${col}`;
}

function getSelectedType() {
  return state.inventory.find((item) => item.id === state.selectedTypeId) || null;
}

function getUsage() {
  return state.placements.reduce((acc, placement) => {
    acc[placement.typeId] = (acc[placement.typeId] || 0) + 1;
    return acc;
  }, {});
}

/* ---------- 订单：库存统一核算 ---------- */

// 已完成订单的字模视为已拆版归还，其余状态（待排版/制作中/返工）都占用库存。
function holdsStock(order) {
  return order.status !== "done";
}

function allocatedElsewhere(typeId, exceptOrderId) {
  return state.orders.reduce((sum, order) => {
    if (order.id === exceptOrderId || !holdsStock(order)) return sum;
    return sum + (order.allocations[typeId] || 0);
  }, 0);
}

// 版面上已落下的字同样占用字模
function boardUsage(typeId) {
  return getUsage()[typeId] || 0;
}

// 某枚字模当前还可分给某订单的数量 = 库存 - 版面落字 - 他单占用
function availableFor(typeId, exceptOrderId) {
  const item = state.inventory.find((entry) => entry.id === typeId);
  if (!item) return 0;
  return Math.max(0, item.quantity - boardUsage(typeId) - allocatedElsewhere(typeId, exceptOrderId));
}

// 库存数量变化、字模移除或版面落字变化后，重核算所有未完成订单：
// 按优先级（高→低，同优先级按交期）依次确认占用，超出可用量的分配一律削减，
// 保证任何订单都不会"显示充足却实际超用"，也不会两单重复占用同一批字模。
// 库存不够时只能保留真实缺口：reconcile 只削减不超用，绝不补到满配。
function reconcileAllocations() {
  const board = getUsage();
  const held = {};
  let changed = false;
  const active = sortedOrders().filter((order) => holdsStock(order));
  for (const order of active) {
    for (const [typeId, qty] of Object.entries(order.allocations)) {
      const item = state.inventory.find((entry) => entry.id === typeId);
      const stock = item ? item.quantity : 0;
      const max = Math.max(0, stock - (board[typeId] || 0) - (held[typeId] || 0));
      if (qty > max) {
        changed = true;
        if (max <= 0) delete order.allocations[typeId];
        else order.allocations[typeId] = max;
      }
    }
    for (const [typeId, qty] of Object.entries(order.allocations)) {
      held[typeId] = (held[typeId] || 0) + qty;
    }
  }
  return changed;
}

/* ---------- 全工坊库存重排 ---------- */

// 制作中的订单锁定不动；待排版/返工订单清空后按优先级、交期重新分配剩余池。
// 每次有实际调整都记录时间、原因和各单前后数量，可撤销最近一次。
function replanAllocations(reason) {
  const participants = sortedOrders().filter((order) => order.status === "pending" || order.status === "rework");
  const beforeMap = new Map(participants.map((order) => [order.id, { ...order.allocations }]));

  // 剩余池 = 库存 - 版面落字 - 制作中订单的锁定占用
  const board = getUsage();
  const locked = {};
  for (const order of state.orders) {
    if (order.status !== "making") continue;
    for (const [typeId, qty] of Object.entries(order.allocations)) {
      locked[typeId] = (locked[typeId] || 0) + qty;
    }
  }
  const pool = {};
  for (const item of state.inventory) {
    pool[item.id] = Math.max(0, item.quantity - (board[item.id] || 0) - (locked[item.id] || 0));
  }

  for (const order of participants) order.allocations = {};
  for (const order of participants) {
    const demand = orderDemand(order);
    const allocations = {};
    for (const [char, need] of Object.entries(demand)) {
      let remaining = need;
      for (const item of state.inventory) {
        if (item.char !== char || remaining <= 0) continue;
        const take = Math.min(pool[item.id], remaining);
        if (take > 0) {
          allocations[item.id] = (allocations[item.id] || 0) + take;
          pool[item.id] -= take;
          remaining -= take;
        }
      }
    }
    order.allocations = allocations;
  }

  const changes = [];
  for (const order of participants) {
    const before = beforeMap.get(order.id) || {};
    const after = order.allocations;
    const typeIds = new Set([...Object.keys(before), ...Object.keys(after)]);
    const items = [...typeIds]
      .map((typeId) => {
        const item = state.inventory.find((entry) => entry.id === typeId);
        const b = before[typeId] || 0;
        const a = after[typeId] || 0;
        if (a === b) return null;
        return { typeId, char: item?.char ?? "?", style: item?.style ?? "已删除", before: b, after: a };
      })
      .filter(Boolean);
    if (items.length) {
      changes.push({ orderId: order.id, orderTitle: order.title, before, after: { ...after }, items });
    }
  }

  if (changes.length) {
    state.replans.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), reason, changes });
    state.replans = state.replans.slice(0, 20);
    notify(`库存重排（${reason}）：调整 ${changes.length} 张订单`, "info");
  }
  return changes;
}

// 版面落字减少（释放字模）时触发重排
function replanIfBoardFreed(beforeUsage, reason) {
  const after = getUsage();
  const freed = Object.keys(beforeUsage).some((typeId) => (after[typeId] || 0) < beforeUsage[typeId]);
  if (freed) replanAllocations(reason);
}

function undoLastReplan() {
  const event = state.replans.find((entry) => !entry.undoneAt);
  if (!event) {
    notify("没有可撤销的重排", "info");
    return;
  }
  let restored = 0;
  const skipped = [];
  for (const change of event.changes) {
    const order = getOrder(change.orderId);
    // 已开工（制作中）或已完成/已删除的订单保持不动，不强行回滚
    if (!order || order.status === "making" || order.status === "done") {
      skipped.push(change.orderTitle);
      continue;
    }
    order.allocations = { ...change.before };
    restored += 1;
  }
  event.undoneAt = new Date().toISOString();
  notify(
    `已撤销重排「${event.reason}」：恢复 ${restored} 单${skipped.length ? `，跳过 ${skipped.length} 单（已开工或已删除）` : ""}`,
    "ok"
  );
  renderAll();
}

function updateOrderPriority(order, priority) {
  if (!PRIORITIES[priority] || order.priority === priority) return;
  order.priority = priority;
  replanAllocations(`订单「${order.title}」优先级调整为「${PRIORITIES[priority].label}」`);
  notify(`「${order.title}」优先级已改为${PRIORITIES[priority].label}`, "ok");
  renderAll();
}

function updateOrderDue(order, dueDate) {
  if (!dueDate || order.dueDate === dueDate) return;
  order.dueDate = dueDate;
  replanAllocations(`订单「${order.title}」交期调整为 ${dueDate}`);
  notify(`「${order.title}」交期已改为 ${dueDate}`, "ok");
  renderAll();
}

function orderDemand(order) {
  const counts = {};
  for (const char of order.text.replace(/\s/g, "")) {
    counts[char] = (counts[char] || 0) + 1;
  }
  return counts;
}

function allocatedChars(order) {
  const byChar = {};
  Object.entries(order.allocations).forEach(([typeId, qty]) => {
    const item = state.inventory.find((entry) => entry.id === typeId);
    if (!item || qty <= 0) return;
    byChar[item.char] = (byChar[item.char] || 0) + qty;
  });
  return byChar;
}

// 缺字/缺量清单：需求 vs 本单已分到的数量
function computeShortages(order) {
  const demand = orderDemand(order);
  const got = allocatedChars(order);
  return Object.entries(demand)
    .map(([char, need]) => ({ char, need, got: got[char] || 0, missing: need - (got[char] || 0) }))
    .filter((entry) => entry.missing > 0)
    .sort((a, b) => b.missing - a.missing);
}

function autoAllocate(order) {
  const demand = orderDemand(order);
  const allocations = {};
  Object.entries(demand).forEach(([char, need]) => {
    let remaining = need;
    const candidates = state.inventory.filter((item) => item.char === char);
    for (const item of candidates) {
      if (remaining <= 0) break;
      const take = Math.min(availableFor(item.id, order.id), remaining);
      if (take > 0) {
        allocations[item.id] = (allocations[item.id] || 0) + take;
        remaining -= take;
      }
    }
  });
  order.allocations = allocations;
  return computeShortages(order);
}

function getOrder(orderId) {
  return state.orders.find((order) => order.id === orderId) || null;
}

function transitionOrder(order, to) {
  const from = ORDER_STATUS[order.status] ? order.status : "pending";
  if (to === from) return;
  const allowed = ORDER_STATUS[from].next;
  if (!allowed.includes(to)) {
    notify(`非法流转：不能从「${ORDER_STATUS[from].label}」直接改为「${ORDER_STATUS[to].label}」`, "warn");
    return;
  }
  if (to === "making") {
    if (!order.text.trim()) {
      notify("订单没有正文内容，无法开工", "warn");
      return;
    }
    // 重新进入生产前，按当前库存、版面落字和他单占用重新核对
    reconcileAllocations();
    const shortages = computeShortages(order);
    if (shortages.length > 0) {
      const preview = shortages
        .slice(0, 3)
        .map((entry) => `「${entry.char}」缺${entry.missing}枚`)
        .join("、");
      notify(
        `库存不足，留在「${ORDER_STATUS[from].label}」：${preview}${shortages.length > 3 ? " 等" : ""}，详见补齐清单`,
        "warn"
      );
      renderAll();
      return;
    }
  }
  order.status = to;
  order.history.push({ at: new Date().toISOString(), from, to });
  if (to === "done") {
    replanAllocations(`订单「${order.title}」完成，释放字模`);
    notify(`「${order.title}」已完成，占用字模已释放回库存`, "ok");
  } else {
    notify(`「${order.title}」${ORDER_STATUS[from].label} → ${ORDER_STATUS[to].label}`, "ok");
  }
  renderAll();
}

/* ---------- 渲染 ---------- */

function renderSettings() {
  els.paperSize.value = state.settings.paperSize;
  els.flowMode.value = state.settings.flowMode;
  els.gridGap.value = state.settings.gridGap;
  els.workTitle.value = state.settings.workTitle;
}

function renderStyleFilter() {
  const current = els.styleFilter.value || "all";
  const styles = [...new Set(state.inventory.map((item) => item.style))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  els.styleFilter.innerHTML = `<option value="all">全部风格</option>${styles
    .map((style) => `<option value="${escapeHtml(style)}">${escapeHtml(style)}</option>`)
    .join("")}`;
  els.styleFilter.value = styles.includes(current) ? current : "all";
}

function renderInventory() {
  const keyword = els.inventorySearch.value.trim();
  const style = els.styleFilter.value;
  const usage = getUsage();
  const items = state.inventory.filter((item) => {
    const matchesKeyword = !keyword || `${item.char}${item.style}${item.wear}`.includes(keyword);
    const matchesStyle = style === "all" || item.style === style;
    return matchesKeyword && matchesStyle;
  });

  els.inventoryCount.textContent = `${state.inventory.length}枚字模`;
  els.typeList.innerHTML = items
    .map((item) => {
      const used = usage[item.id] || 0;
      const reserved = allocatedElsewhere(item.id, null);
      const selected = item.id === state.selectedTypeId ? "selected" : "";
      return `
        <article class="type-card ${selected}" draggable="true" data-type-id="${item.id}">
          <div class="glyph" style="font-size:${Math.min(item.size, 36)}px">${escapeHtml(item.char)}</div>
          <div class="type-meta">
            <strong>${escapeHtml(item.char)} · ${escapeHtml(item.style)}</strong>
            <span>${item.size}px · ${escapeHtml(item.wear)} · 版面已用${used}/${item.quantity}${reserved ? ` · 订单占用${reserved}` : ""}</span>
            <span class="qty-stepper" data-stop-select>库存
              <button type="button" class="step-btn" data-dec-type="${item.id}" title="减少库存">−</button>
              <b>${item.quantity}</b>
              <button type="button" class="step-btn" data-inc-type="${item.id}" title="增加库存">＋</button>
            </span>
          </div>
          <button class="mini-btn" title="删除字模" data-delete-type="${item.id}" type="button">×</button>
        </article>
      `;
    })
    .join("");
}

function renderStage() {
  const { cols, rows } = getGrid();
  const map = new Map(state.placements.map((item) => [placementKey(item.row, item.col), item]));
  els.stage.className = `stage ${state.settings.paperSize}`;
  els.stage.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  els.stage.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  els.stage.style.gap = `${state.settings.gridGap}px`;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const placement = map.get(placementKey(row, col));
      const type = placement ? state.inventory.find((item) => item.id === placement.typeId) : null;
      const vertical = state.settings.flowMode === "vertical" ? "vertical" : "";
      cells.push(`
        <button class="cell ${type ? "used" : ""} ${vertical}" data-row="${row}" data-col="${col}" type="button" aria-label="第${row + 1}行第${col + 1}列">
          ${type ? escapeHtml(type.char) : ""}
        </button>
      `);
    }
  }
  els.stage.innerHTML = cells.join("");
}

function renderUsage() {
  const usage = getUsage();
  const entries = state.inventory.filter((item) => usage[item.id]);
  els.placedCount.textContent = `${state.placements.length}个落字`;

  const shortages = entries.filter((item) => usage[item.id] > item.quantity);
  els.shortageBadge.textContent = shortages.length ? `${shortages.length}处超量` : "数量充足";
  els.shortageBadge.className = `badge ${shortages.length ? "warn" : "ok"}`;

  const selectedType = getSelectedType();
  els.selectedTypeLabel.textContent = selectedType ? `当前：${selectedType.char} · ${selectedType.style}` : "未选择字模";

  els.usageList.innerHTML =
    entries
      .map((item) => {
        const used = usage[item.id];
        const warn = used > item.quantity ? "warn" : "";
        return `
          <div class="usage-item ${warn}">
            <strong>${escapeHtml(item.char)} ${escapeHtml(item.style)}</strong>
            <span>${used}/${item.quantity}</span>
          </div>
        `;
      })
      .join("") || `<p class="empty">还没有落字。</p>`;
}

function renderDrafts() {
  els.draftList.innerHTML =
    state.drafts
      .map(
        (draft) => `
          <article class="draft-item">
            <strong>${escapeHtml(draft.title)}</strong>
            <span>${draft.placements.length}个落字 · ${new Date(draft.savedAt).toLocaleString("zh-CN")}</span>
            <div class="draft-actions">
              <button type="button" data-load-draft="${draft.id}">载入</button>
              <button type="button" data-delete-draft="${draft.id}">删除</button>
            </div>
          </article>
        `
      )
      .join("") || `<p class="empty">还没有保存草稿。</p>`;
}

/* ---------- 订单渲染 ---------- */

function formatTime(iso) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function isOverdue(order) {
  if (order.status === "done" || !order.dueDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return order.dueDate < today;
}

function sortedOrders() {
  const weight = (order) => (PRIORITIES[order.priority] || PRIORITIES.medium).weight;
  return [...state.orders].sort((a, b) => {
    const aDone = a.status === "done" ? 1 : 0;
    const bDone = b.status === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const byPriority = weight(b) - weight(a);
    if (byPriority !== 0) return byPriority;
    const byDue = (a.dueDate || "").localeCompare(b.dueDate || "");
    if (byDue !== 0) return byDue;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  });
}

function renderOrderList() {
  const orders = sortedOrders();
  const activeCount = state.orders.filter((order) => order.status !== "done").length;
  els.orderCount.textContent = `${state.orders.length}张订单`;
  els.orderTabBadge.hidden = activeCount === 0;
  els.orderTabBadge.textContent = activeCount;

  els.orderList.innerHTML =
    orders
      .map((order) => {
        const status = ORDER_STATUS[order.status] || ORDER_STATUS.pending;
        const priority = PRIORITIES[order.priority] || PRIORITIES.medium;
        const shortages = computeShortages(order);
        const selected = order.id === state.selectedOrderId ? "selected" : "";
        const overdue = isOverdue(order) ? `<span class="chip red">已逾期</span>` : "";
        const shortageChip =
          order.status !== "done" && shortages.length
            ? `<span class="chip red">缺${shortages.length}项</span>`
            : "";
        const lastChange = order.history.length ? formatTime(order.history[order.history.length - 1].at) : "";
        return `
          <article class="order-card ${selected}" data-order-id="${order.id}" tabindex="0" role="button">
            <div class="order-card-head">
              <strong>${escapeHtml(order.title)}</strong>
              <span class="chip ${status.chip}">${status.label}</span>
            </div>
            <div class="order-card-meta">
              <span class="chip prio-${order.priority}">优先级·${priority.label}</span>
              <span>交期 ${escapeHtml(order.dueDate || "未填")}</span>
              ${overdue}
              ${shortageChip}
            </div>
            <div class="order-card-foot">
              <span>${PAPER_LABELS[order.paperSize] || order.paperSize} · ${FLOW_LABELS[order.flowMode] || order.flowMode} · ${order.text.replace(/\s/g, "").length}字</span>
              <span>${lastChange ? `更新 ${lastChange}` : ""}</span>
            </div>
          </article>
        `;
      })
      .join("") || `<p class="empty">还没有订单，用上方表单创建第一张。</p>`;
}

function renderOrderDetail() {
  const order = getOrder(state.selectedOrderId);
  if (!order) {
    els.orderDetail.innerHTML = `
      <div class="detail-empty">
        <h2>订单详情</h2>
        <p class="empty">在左侧选择一张订单查看分配、补齐清单和流转记录。</p>
      </div>`;
    return;
  }

  const status = ORDER_STATUS[order.status] || ORDER_STATUS.pending;
  const priority = PRIORITIES[order.priority] || PRIORITIES.medium;
  const demand = orderDemand(order);
  const shortages = computeShortages(order);

  const demandChars = new Set(Object.keys(demand));
  const rows = state.inventory.filter((item) => demandChars.has(item.char));
  const usage = getUsage();
  const allocRows = rows
    .map((item) => {
      const mine = order.allocations[item.id] || 0;
      const onBoard = usage[item.id] || 0;
      const others = allocatedElsewhere(item.id, order.id);
      const max = Math.max(0, item.quantity - onBoard - others);
      return `
        <tr>
          <td><strong>${escapeHtml(item.char)}</strong> · ${escapeHtml(item.style)} · ${item.size}px</td>
          <td>${item.quantity}</td>
          <td>${onBoard}</td>
          <td>${others}</td>
          <td>
            <input class="alloc-input" type="number" min="0" max="${max}" value="${mine}"
              data-alloc-type="${item.id}" ${order.status === "done" ? "disabled" : ""} />
          </td>
          <td>≤ ${max}</td>
        </tr>
      `;
    })
    .join("");

  const shortageHtml = shortages.length
    ? `<ul class="shortage-list">
        ${shortages
          .map((entry) => {
            const inStock = state.inventory.some((item) => item.char === entry.char);
            return `<li>「${escapeHtml(entry.char)}」缺 <strong>${entry.missing}</strong> 枚（需求${entry.need}，已分${entry.got}）${inStock ? "" : " · 字库中暂无此字，请先补入字模"}</li>`;
          })
          .join("")}
      </ul>
      <p class="hint">请到「排版工坊 → 字模库」补充对应字模后，回到这里重新自动分配。</p>`
    : `<p class="ok-line">字模齐备，可以开工。</p>`;

  const statusButtons = Object.entries(ORDER_STATUS)
    .map(([key, meta]) => {
      const current = key === order.status ? "current" : "";
      return `<button type="button" class="status-btn ${meta.chip} ${current}" data-transition="${key}">${meta.label}</button>`;
    })
    .join("");

  const historyHtml = order.history.length
    ? `<ul class="history-list">
        ${[...order.history]
          .reverse()
          .map(
            (entry) => `
          <li>
            <span>${formatTime(entry.at)}</span>
            <strong>${(ORDER_STATUS[entry.from] || ORDER_STATUS.pending).label} → ${(ORDER_STATUS[entry.to] || ORDER_STATUS.pending).label}</strong>
          </li>`
          )
          .join("")}
      </ul>`
    : `<p class="empty">还没有流转记录。</p>`;

  const orderReplans = state.replans.filter((event) => event.changes.some((change) => change.orderId === order.id));
  const replanHtml = orderReplans.length
    ? `<ul class="history-list">
        ${orderReplans
          .map((event) => {
            const change = event.changes.find((entry) => entry.orderId === order.id);
            return `
          <li class="${event.undoneAt ? "undone" : ""}">
            <span>${formatTime(event.at)}</span>
            <div class="replan-change">
              <strong>${escapeHtml(event.reason)}</strong>
              <div class="replan-items">${change.items
                .map((item) => `「${escapeHtml(item.char)}」${escapeHtml(item.style)} ${item.before}→${item.after}`)
                .join("；")}</div>
              ${event.undoneAt ? `<em>已于 ${formatTime(event.undoneAt)} 撤销</em>` : ""}
            </div>
          </li>`;
          })
          .join("")}
      </ul>`
    : `<p class="empty">本单还没有被重排调整过。</p>`;

  els.orderDetail.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${escapeHtml(order.title)}</h2>
        <div class="order-card-meta">
          <span class="chip ${status.chip}">${status.label}</span>
          <span class="chip prio-${order.priority}">优先级·${priority.label}</span>
          ${isOverdue(order) ? `<span class="chip red">已逾期</span>` : ""}
        </div>
      </div>
      <button type="button" class="mini-btn danger" data-delete-order="${order.id}" title="删除订单">×</button>
    </div>

    <dl class="detail-grid">
      <div><dt>交期</dt><dd><input type="date" data-edit-due value="${escapeHtml(order.dueDate || "")}" /></dd></div>
      <div><dt>优先级</dt><dd>
        <select data-edit-prio>
          ${Object.entries(PRIORITIES)
            .map(([key, meta]) => `<option value="${key}" ${order.priority === key ? "selected" : ""}>${meta.label}</option>`)
            .join("")}
        </select>
      </dd></div>
      <div><dt>纸张</dt><dd>${PAPER_LABELS[order.paperSize] || order.paperSize}</dd></div>
      <div><dt>排版</dt><dd>${FLOW_LABELS[order.flowMode] || order.flowMode}</dd></div>
      <div><dt>创建</dt><dd>${formatTime(order.createdAt)}</dd></div>
    </dl>

    <h3>正文（${order.text.replace(/\s/g, "").length}字）</h3>
    <p class="order-text">${escapeHtml(order.text)}</p>

    <div class="detail-actions">
      <button type="button" class="primary" data-auto-alloc="${order.id}" ${order.status === "done" ? "disabled" : ""}>按库存自动分配</button>
      <button type="button" data-open-editor="${order.id}">在编辑器中打开版面</button>
    </div>

    <h3>字模分配（全工坊统一核算，不能超过可用量）</h3>
    ${
      rows.length
        ? `<table class="alloc-table">
            <thead><tr><th>字模</th><th>库存</th><th>版面占用</th><th>他单占用</th><th>本单分配</th><th>可调上限</th></tr></thead>
            <tbody>${allocRows}</tbody>
          </table>`
        : `<p class="empty">正文中的字在字库中还没有任何字模。</p>`
    }

    <h3>补齐清单</h3>
    ${shortageHtml}

    <h3>状态流转</h3>
    <div class="status-flow">${statusButtons}</div>
    <p class="hint">允许：待排版→制作中→已完成；已完成→返工→制作中；制作中可退回待排版。其余跳跃会被拦截。</p>

    <h3>变更记录</h3>
    ${historyHtml}

    <h3>重排调整记录</h3>
    ${replanHtml}
  `;
}

function renderReplanLog() {
  els.replanLog.innerHTML =
    state.replans
      .slice(0, 6)
      .map(
        (event) => `
        <article class="replan-item ${event.undoneAt ? "undone" : ""}">
          <strong>${escapeHtml(event.reason)}</strong>
          <span>${formatTime(event.at)} · 调整${event.changes.length}单${event.undoneAt ? " · 已撤销" : ""}</span>
        </article>
      `
      )
      .join("") || `<p class="empty">还没有重排记录。</p>`;
  els.undoReplanBtn.disabled = !state.replans.some((event) => !event.undoneAt);
}

function renderView() {
  const isEditor = state.view === "editor";
  els.editorView.hidden = !isEditor;
  els.ordersView.hidden = isEditor;
  els.editorActions.hidden = !isEditor;
  els.editorTab.classList.toggle("active", isEditor);
  els.ordersTab.classList.toggle("active", !isEditor);
}

function renderAll() {
  if (reconcileAllocations()) {
    notify("库存或版面占用有变化，已重新核算所有未完成订单的分配", "info");
  }
  saveState();
  renderView();
  renderSettings();
  renderStyleFilter();
  renderInventory();
  renderStage();
  renderUsage();
  renderDrafts();
  renderOrderList();
  renderOrderDetail();
  renderReplanLog();
}

/* ---------- 编辑器操作 ---------- */

function placeType(row, col, typeId = state.selectedTypeId) {
  if (!typeId) return;
  const beforeUsage = getUsage();
  const existingIndex = state.placements.findIndex((item) => item.row === row && item.col === col);
  if (existingIndex >= 0) {
    if (state.placements[existingIndex].typeId === typeId) {
      state.placements.splice(existingIndex, 1);
    } else {
      state.placements[existingIndex].typeId = typeId;
    }
  } else {
    state.placements.push({ row, col, typeId });
  }
  replanIfBoardFreed(beforeUsage, "版面落字释放");
  renderAll();
}

function addType(event) {
  event.preventDefault();
  const item = {
    id: crypto.randomUUID(),
    char: els.charInput.value.trim(),
    style: els.styleInput.value.trim(),
    size: Number(els.sizeInput.value),
    quantity: Number(els.quantityInput.value),
    wear: els.wearInput.value
  };
  if (!item.char || !item.style) {
    notify("请填写字和风格", "warn");
    return;
  }
  state.inventory.unshift(item);
  state.selectedTypeId = item.id;
  els.typeForm.reset();
  els.sizeInput.value = 24;
  els.quantityInput.value = 3;
  replanAllocations(`新增字模「${item.char}」×${item.quantity}，库存回升`);
  notify(`已加入字模「${item.char}」×${item.quantity}`, "ok");
  renderAll();
}

function saveDraft() {
  const title = state.settings.workTitle.trim() || "未命名作品";
  state.drafts.unshift({
    id: crypto.randomUUID(),
    title,
    settings: structuredClone(state.settings),
    placements: structuredClone(state.placements),
    savedAt: new Date().toISOString()
  });
  state.drafts = state.drafts.slice(0, 8);
  notify(`草稿「${title}」已保存`, "ok");
  renderAll();
}

function exportPreview() {
  const { cols, rows } = getGrid();
  const cell = state.settings.paperSize === "bookmark" ? 44 : 56;
  const gap = state.settings.gridGap;
  const margin = 48;
  const width = cols * cell + (cols - 1) * gap + margin * 2;
  const height = rows * cell + (rows - 1) * gap + margin * 2 + 70;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffaf1";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#2f2921";
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, width - 36, height - 36);
  ctx.fillStyle = "#22201c";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(state.settings.workTitle || "未命名作品", margin, 50);
  ctx.font = "bold 30px serif";
  state.placements.forEach((placement) => {
    const type = state.inventory.find((item) => item.id === placement.typeId);
    if (!type) return;
    const x = margin + placement.col * (cell + gap);
    const y = margin + 45 + placement.row * (cell + gap);
    ctx.fillStyle = "#2f2921";
    ctx.fillRect(x, y, cell, cell);
    ctx.fillStyle = "#fff5df";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${Math.min(type.size + 8, 42)}px serif`;
    ctx.fillText(type.char, x + cell / 2, y + cell / 2);
  });
  const link = document.createElement("a");
  link.download = `${state.settings.workTitle || "movable-type"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
  notify("预览图已导出", "ok");
}

/* ---------- 订单操作 ---------- */

function createOrder(event) {
  event.preventDefault();
  const title = els.orderTitle.value.trim();
  const dueDate = els.orderDue.value;
  const text = els.orderText.value.trim();
  if (!title) {
    notify("请填写订单名称", "warn");
    return;
  }
  if (!dueDate) {
    notify("请选择交期", "warn");
    return;
  }
  if (!text) {
    notify("请填写正文内容，系统要按字核算字模", "warn");
    return;
  }
  const order = {
    id: crypto.randomUUID(),
    title,
    dueDate,
    priority: PRIORITIES[els.orderPriority.value] ? els.orderPriority.value : "medium",
    paperSize: PAPER_LABELS[els.orderPaper.value] ? els.orderPaper.value : "postcard",
    flowMode: FLOW_LABELS[els.orderFlow.value] ? els.orderFlow.value : "horizontal",
    text,
    status: "pending",
    allocations: {},
    createdAt: new Date().toISOString(),
    history: []
  };
  order.history.push({ at: new Date().toISOString(), from: "pending", to: "pending", note: "创建订单" });
  state.orders.unshift(order);
  state.selectedOrderId = order.id;
  els.orderForm.reset();
  replanAllocations(`新增订单「${title}」`);
  const shortages = computeShortages(order);
  notify(
    shortages.length
      ? `订单「${title}」已创建，${shortages.length} 项字模不足，见补齐清单`
      : `订单「${title}」已创建，字模已分齐`,
    shortages.length ? "warn" : "ok"
  );
  renderAll();
}

function deleteOrder(orderId) {
  const order = getOrder(orderId);
  if (!order) return;
  if (!window.confirm(`确定删除订单「${order.title}」？其占用的字模会立即释放。`)) return;
  state.orders = state.orders.filter((entry) => entry.id !== orderId);
  if (state.selectedOrderId === orderId) state.selectedOrderId = state.orders[0]?.id || null;
  replanAllocations(`订单「${order.title}」删除，释放字模`);
  notify(`订单「${order.title}」已删除，占用字模已释放`, "ok");
  renderAll();
}

function adjustAllocation(order, typeId, rawValue, inputEl) {
  const item = state.inventory.find((entry) => entry.id === typeId);
  if (!item) return;
  const onBoard = boardUsage(typeId);
  const others = allocatedElsewhere(typeId, order.id);
  const max = Math.max(0, item.quantity - onBoard - others);
  let value = Number.parseInt(rawValue, 10);
  if (Number.isNaN(value) || value < 0) value = 0;
  if (value > max) {
    notify(
      `「${item.char}」最多只能分 ${max} 枚（库存${item.quantity}，版面占用${onBoard}，他单占用${others}），不能超用`,
      "warn"
    );
    value = max;
  }
  if (value === 0) {
    delete order.allocations[typeId];
  } else {
    order.allocations[typeId] = value;
  }
  inputEl.value = value;
  renderAll();
}

function openOrderInEditor(order) {
  state.settings.paperSize = order.paperSize;
  state.settings.flowMode = order.flowMode;
  state.settings.workTitle = order.title;
  const { cols, rows } = getGrid();
  state.placements = state.placements.filter((item) => item.row < rows && item.col < cols);
  state.view = "editor";
  notify(`已按订单「${order.title}」设置纸张与排版方向，可在版面落字`, "ok");
  renderAll();
}

/* ---------- 工具 ---------- */

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------- 事件绑定 ---------- */

els.editorTab.addEventListener("click", () => {
  state.view = "editor";
  renderAll();
});

els.ordersTab.addEventListener("click", () => {
  state.view = "orders";
  renderAll();
});

els.paperSize.addEventListener("change", () => {
  const beforeUsage = getUsage();
  state.settings.paperSize = els.paperSize.value;
  const { cols, rows } = getGrid();
  state.placements = state.placements.filter((item) => item.row < rows && item.col < cols);
  replanIfBoardFreed(beforeUsage, "切换纸张，版面释放字模");
  renderAll();
});

els.flowMode.addEventListener("change", () => {
  state.settings.flowMode = els.flowMode.value;
  renderAll();
});

els.gridGap.addEventListener("input", () => {
  state.settings.gridGap = Number(els.gridGap.value);
  renderAll();
});

els.workTitle.addEventListener("input", () => {
  state.settings.workTitle = els.workTitle.value;
  saveState();
});

els.typeForm.addEventListener("submit", addType);
els.inventorySearch.addEventListener("input", renderInventory);
els.styleFilter.addEventListener("change", renderInventory);
els.saveDraftBtn.addEventListener("click", saveDraft);
els.exportBtn.addEventListener("click", exportPreview);
els.clearBoardBtn.addEventListener("click", () => {
  if (!state.placements.length) {
    notify("版面已经是空的", "info");
    return;
  }
  state.placements = [];
  replanAllocations("清空版面，释放字模");
  notify("版面已清空", "ok");
  renderAll();
});

els.typeList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-type]");
  if (deleteButton) {
    const typeId = deleteButton.dataset.deleteType;
    const item = state.inventory.find((entry) => entry.id === typeId);
    state.inventory = state.inventory.filter((entry) => entry.id !== typeId);
    state.placements = state.placements.filter((entry) => entry.typeId !== typeId);
    state.orders.forEach((order) => {
      delete order.allocations[typeId];
    });
    if (state.selectedTypeId === typeId) state.selectedTypeId = state.inventory[0]?.id || null;
    notify(`字模「${item?.char ?? ""}」已删除，相关订单分配同步移除`, "ok");
    renderAll();
    return;
  }
  const stepButton = event.target.closest("[data-inc-type], [data-dec-type]");
  if (stepButton) {
    const typeId = stepButton.dataset.incType || stepButton.dataset.decType;
    const item = state.inventory.find((entry) => entry.id === typeId);
    if (!item) return;
    const delta = stepButton.dataset.incType ? 1 : -1;
    const next = Math.min(99, Math.max(1, item.quantity + delta));
    if (next === item.quantity) {
      notify(`「${item.char}」库存范围 1–99，不能再${delta > 0 ? "加" : "减"}`, "info");
      return;
    }
    const prev = item.quantity;
    item.quantity = next;
    if (delta > 0) replanAllocations(`「${item.char}」库存回升 ${prev}→${next}`);
    notify(`「${item.char}」库存调整为 ${next}，订单分配已重新核算`, "ok");
    renderAll();
    return;
  }
  const card = event.target.closest("[data-type-id]");
  if (!card) return;
  state.selectedTypeId = card.dataset.typeId;
  renderAll();
});

els.typeList.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-type-id]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.typeId);
});

els.stage.addEventListener("dragover", (event) => {
  if (event.target.closest(".cell")) event.preventDefault();
});

els.stage.addEventListener("drop", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  event.preventDefault();
  placeType(Number(cell.dataset.row), Number(cell.dataset.col), event.dataTransfer.getData("text/plain"));
});

els.stage.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  placeType(Number(cell.dataset.row), Number(cell.dataset.col));
});

els.draftList.addEventListener("click", (event) => {
  const loadButton = event.target.closest("[data-load-draft]");
  const deleteButton = event.target.closest("[data-delete-draft]");
  if (loadButton) {
    const draft = state.drafts.find((item) => item.id === loadButton.dataset.loadDraft);
    if (!draft) return;
    const beforeUsage = getUsage();
    state.settings = structuredClone(draft.settings);
    state.placements = structuredClone(draft.placements);
    replanIfBoardFreed(beforeUsage, "载入草稿，版面释放字模");
    notify(`草稿「${draft.title}」已载入`, "ok");
    renderAll();
  }
  if (deleteButton) {
    state.drafts = state.drafts.filter((item) => item.id !== deleteButton.dataset.deleteDraft);
    renderAll();
  }
});

els.orderForm.addEventListener("submit", createOrder);

els.orderList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-order-id]");
  if (!card) return;
  state.selectedOrderId = card.dataset.orderId;
  renderAll();
});

els.orderList.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest("[data-order-id]");
  if (!card) return;
  event.preventDefault();
  state.selectedOrderId = card.dataset.orderId;
  renderAll();
});

els.orderDetail.addEventListener("click", (event) => {
  const order = getOrder(state.selectedOrderId);
  if (!order) return;

  const autoButton = event.target.closest("[data-auto-alloc]");
  if (autoButton) {
    const shortages = autoAllocate(order);
    notify(
      shortages.length ? `自动分配完成，仍缺 ${shortages.length} 项，见补齐清单` : "自动分配完成，字模已分齐",
      shortages.length ? "warn" : "ok"
    );
    renderAll();
    return;
  }

  const openButton = event.target.closest("[data-open-editor]");
  if (openButton) {
    openOrderInEditor(order);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-order]");
  if (deleteButton) {
    deleteOrder(deleteButton.dataset.deleteOrder);
    return;
  }

  const transitionButton = event.target.closest("[data-transition]");
  if (transitionButton) {
    transitionOrder(order, transitionButton.dataset.transition);
  }
});

els.orderDetail.addEventListener("change", (event) => {
  const order = getOrder(state.selectedOrderId);
  if (!order) return;

  const prioSelect = event.target.closest("[data-edit-prio]");
  if (prioSelect) {
    updateOrderPriority(order, prioSelect.value);
    return;
  }

  const dueInput = event.target.closest("[data-edit-due]");
  if (dueInput) {
    if (!dueInput.value) {
      notify("交期不能为空", "warn");
      dueInput.value = order.dueDate || "";
      return;
    }
    updateOrderDue(order, dueInput.value);
    return;
  }

  const input = event.target.closest("[data-alloc-type]");
  if (!input) return;
  adjustAllocation(order, input.dataset.allocType, input.value, input);
});

els.replanNowBtn.addEventListener("click", () => {
  const changes = replanAllocations("手动全工坊重排");
  if (!changes.length) notify("重排完成：当前分配无需调整", "info");
  renderAll();
});

els.undoReplanBtn.addEventListener("click", undoLastReplan);

renderAll();
