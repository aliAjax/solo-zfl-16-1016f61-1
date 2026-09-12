// 测试基建：最小 DOM/localStorage 桩 + 三类问题探测器（库存超用、日志缺失、撤销虚报）
// 纯 Node 运行，不依赖浏览器或外部服务。
const fs = require("fs");
const path = require("path");

const APP_PATH = path.join(__dirname, "..", "app.js");
const STORAGE_KEY = "zfl16-movable-type-workshop";

/* ---------- DOM 桩 ---------- */

function makeEl(tag) {
  const el = {
    tagName: String(tag || "div").toUpperCase(),
    value: "",
    textContent: "",
    innerHTML: "",
    className: "",
    hidden: false,
    disabled: false,
    style: {},
    dataset: {},
    classList: {
      _set: new Set(),
      toggle(c, on) { on ? this._set.add(c) : this._set.delete(c); },
      add(c) { this._set.add(c); },
      contains(c) { return this._set.has(c); }
    },
    addEventListener(type, fn) { (el._handlers[type] ||= []).push(fn); },
    reset() { el._resetCount = (el._resetCount || 0) + 1; },
    click() {},
    querySelector() { return makeEl(); },
    closest() { return null; },
    _handlers: {}
  };
  if (tag === "canvas") {
    el.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
    el.toDataURL = () => "data:image/png;base64,TEST";
  }
  return el;
}

// 用同一 store 多次 boot 即可模拟刷新
function boot(store = {}) {
  const registry = new Map();
  const documentStub = {
    querySelector(sel) {
      if (!registry.has(sel)) registry.set(sel, makeEl(sel.replace(/^#/, "")));
      return registry.get(sel);
    },
    createElement(tag) { return makeEl(tag); }
  };
  const localStorageStub = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const code = fs.readFileSync(APP_PATH, "utf8");
  const expose = `
    ;return {
      get state(){return state},
      createOrder, transitionOrder, placeType, addType, saveDraft, exportPreview,
      replanAllocations, reconcileAllocations, undoLastReplan,
      updateOrderPriority, updateOrderDue, computeShortages, availableFor,
      allocatedElsewhere, getUsage, renderAll, autoAllocate, changeTypeQuantity,
      deleteType, getOrder, sortedOrders, holdsStock, adjustAllocation
    }`;
  const factory = new Function(
    "document", "window", "localStorage", "crypto", "setTimeout", "clearTimeout",
    code + expose
  );
  const app = factory(
    documentStub,
    { confirm: () => true },
    localStorageStub,
    require("crypto").webcrypto,
    () => 0, // setTimeout 桩：避免真定时器拖住进程
    () => {}
  );
  const $ = (sel) => registry.get(sel);
  return {
    app,
    $,
    store,
    toast: () => ({ text: $("#toast").textContent, type: $("#toast").className.replace("toast", "").trim() }),
    fireSubmit(sel) { $(sel)._handlers.submit.forEach((fn) => fn({ preventDefault() {} })); },
    fireClick(sel, fakeTarget) {
      $(sel)._handlers.click.forEach((fn) => fn(fakeTarget || { target: { closest: () => null } }));
    },
    fireChange(sel, fakeTarget) {
      ($(sel)._handlers.change || []).forEach((fn) => fn(fakeTarget || { target: { closest: () => null } }));
    }
  };
}

function createOrderViaForm(b, { title, due = "2026-09-20", text, priority = "medium", paper = "postcard", flow = "horizontal" }) {
  b.$("#orderTitle").value = title;
  b.$("#orderDue").value = due;
  b.$("#orderText").value = text;
  b.$("#orderPriority").value = priority;
  b.$("#orderPaper").value = paper;
  b.$("#orderFlow").value = flow;
  b.fireSubmit("#orderForm");
  return b.app.state.orders[0];
}

/* ---------- 探测器：库存超用 ---------- */

// 不变量：每种字模，未完成订单占用合计 ≤ 库存 − 版面落字；无幽灵分配；已完成订单不保留分配
function findOverUse(app) {
  const problems = [];
  const board = {};
  for (const p of app.state.placements) board[p.typeId] = (board[p.typeId] || 0) + 1;
  const held = {};
  for (const o of app.state.orders) {
    if (o.status === "done") continue;
    for (const [t, q] of Object.entries(o.allocations)) held[t] = (held[t] || 0) + q;
  }
  for (const item of app.state.inventory) {
    const allowance = Math.max(0, item.quantity - (board[item.id] || 0));
    const total = held[item.id] || 0;
    if (total > allowance) {
      problems.push(`「${item.char}」订单占用${total} > 可用${allowance}（库存${item.quantity}，版面落字${board[item.id] || 0}）`);
    }
  }
  for (const o of app.state.orders) {
    if (o.status === "done" && Object.keys(o.allocations).length > 0) {
      problems.push(`订单「${o.title}」显示已完成却仍保留旧分配 ${JSON.stringify(o.allocations)}`);
    }
    if (o.status === "done") continue;
    for (const [t, q] of Object.entries(o.allocations)) {
      if (!app.state.inventory.find((i) => i.id === t)) problems.push(`订单「${o.title}」分配了不存在的字模 ${t}×${q}`);
      if (!Number.isInteger(q) || q <= 0) problems.push(`订单「${o.title}」分配数量异常：${q}`);
    }
  }
  return problems;
}

/* ---------- 探测器：日志缺失 ---------- */

function snapshotAllocations(app) {
  const snap = {};
  for (const o of app.state.orders) snap[o.id] = { ...o.allocations };
  return snap;
}

// 快照之后发生的分配变化，必须都有带前后数量的调整记录覆盖
function findLogProblems(app, logCursor, snap) {
  const problems = [];
  const newEvents = app.state.replans.slice(0, app.state.replans.length - logCursor);
  for (const e of newEvents) {
    if (!e.at || !e.reason) problems.push("存在缺时间或原因的调整记录");
    for (const c of e.changes || []) {
      if (!Array.isArray(c.items) || c.items.length === 0) {
        problems.push(`事件「${e.reason}」的「${c.orderTitle}」缺少前后数量明细`);
      } else if (c.items.some((i) => typeof i.before !== "number" || typeof i.after !== "number")) {
        problems.push(`事件「${e.reason}」的前后数量不是数字`);
      }
    }
  }
  const covered = new Set(newEvents.flatMap((e) => e.changes.map((c) => c.orderId)));
  for (const o of app.state.orders) {
    const before = snap[o.id] || {};
    const keys = new Set([...Object.keys(before), ...Object.keys(o.allocations)]);
    const changed = [...keys].some((k) => (before[k] || 0) !== (o.allocations[k] || 0));
    if (changed && !covered.has(o.id)) {
      problems.push(`订单「${o.title}」分配被改动但没有任何调整记录`);
    }
  }
  return problems;
}

/* ---------- 探测器：撤销虚报 ---------- */

function sameAlloc(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

// 撤销尝试之后立即校验：标记与真实分配必须一致
function findUndoLies(app, event) {
  const problems = [];
  if (event.undoneAt && event.partialUndo) {
    problems.push(`事件「${event.reason}」同时挂着"已撤销"和"部分恢复"两个标记`);
  }
  for (const change of event.changes) {
    const order = app.state.orders.find((o) => o.id === change.orderId);
    if (event.undoneAt) {
      if (!order) continue;
      if (order.status === "making" || order.status === "done") {
        problems.push(`事件「${event.reason}」虚报已撤销：「${order.title}」已${order.status === "making" ? "制作中" : "完成"}，不可能被完整恢复`);
      } else if (!sameAlloc(order.allocations, change.before)) {
        problems.push(
          `事件「${event.reason}」虚报已撤销：「${order.title}」分配未还原，期望${JSON.stringify(change.before)}，实际${JSON.stringify(order.allocations)}`
        );
      }
    } else if (event.partialUndo) {
      const missed = event.partialUndo.unrestored.find((u) => u.orderId === change.orderId);
      if (!missed && order && order.status !== "making" && order.status !== "done" && !sameAlloc(order.allocations, change.before)) {
        problems.push(`部分恢复记录称「${order.title}」已还原，但分配不符：${JSON.stringify(order.allocations)}`);
      }
    }
  }
  return problems;
}

/* ---------- 断言 ---------- */

const results = { pass: 0, fail: 0, failures: [] };

function check(name, cond, detail) {
  if (cond) {
    results.pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    results.fail += 1;
    results.failures.push(name);
    console.log(`  ✗ ${name}`);
    if (detail) console.log(`    ${String(detail).split("\n").join("\n    ")}`);
  }
}

function checkProblems(name, problems) {
  check(name, problems.length === 0, problems.map((p) => `· ${p}`).join("\n"));
}

module.exports = {
  STORAGE_KEY,
  boot,
  createOrderViaForm,
  findOverUse,
  snapshotAllocations,
  findLogProblems,
  findUndoLies,
  check,
  checkProblems,
  results
};
