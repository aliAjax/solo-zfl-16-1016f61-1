// 刷新持久化：订单、分配、版面、草稿、重排日志（含部分恢复/已撤销标记）重启后一致
// 递归排序对象键后比较，避免 loadState 合并默认值造成的键序差异误报
function canon(value) {
  return JSON.stringify(value, (key, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val
  );
}

module.exports = {
  name: "刷新持久化",
  run(h) {
    const store = {};
    const b1 = h.boot(store);
    const { app } = b1;
    const shan = () => app.state.inventory.find((i) => i.char === "山");
    const shanOf = (o) => o.allocations[shan().id] || 0;

    // 构造复杂状态：版面落字、草稿、三张订单（制作中/待排版/已完成）、重排日志
    app.placeType(0, 0, shan().id);
    b1.$("#workTitle").value = "持久化小笺";
    b1.fireClick("#saveDraftBtn");
    const oMaking = h.createOrderViaForm(b1, { title: "制作中单", text: "山山", priority: "high" });
    const oPending = h.createOrderViaForm(b1, { title: "待排单", text: "山山山", priority: "low" });
    app.transitionOrder(oMaking, "making");
    const oDone = h.createOrderViaForm(b1, { title: "完成单", text: "茶", priority: "medium" });
    app.transitionOrder(oDone, "making");
    app.transitionOrder(oDone, "done");

    // 制造一次部分恢复：下调削减后库存不足时撤销
    shan().quantity = 3;
    app.reconcileAllocations("「山」库存下调 4→3");
    const trimEvent = app.state.replans[0];
    app.undoLastReplan(); // 制作中锁定，放不回 → 不标记
    h.check("撤销被拒事件未标记", !trimEvent.undoneAt);

    const snapshot = {
      orders: canon(app.state.orders),
      replans: canon(app.state.replans),
      placements: canon(app.state.placements),
      drafts: canon(app.state.drafts)
    };

    // 模拟刷新：同一 store 重新启动
    const b2 = h.boot(store);
    const app2 = b2.app;
    h.check("刷新后订单一致", canon(app2.state.orders) === snapshot.orders);
    h.check("刷新后重排日志一致", canon(app2.state.replans) === snapshot.replans);
    h.check("刷新后版面落字一致", canon(app2.state.placements) === snapshot.placements);
    h.check("刷新后草稿一致", canon(app2.state.drafts) === snapshot.drafts);

    const shan2 = () => app2.state.inventory.find((i) => i.char === "山");
    const oMaking2 = app2.state.orders.find((o) => o.id === oMaking.id);
    const oPending2 = app2.state.orders.find((o) => o.id === oPending.id);
    const oDone2 = app2.state.orders.find((o) => o.id === oDone.id);
    h.check("制作中状态与分配保持", oMaking2.status === "making" && oMaking2.allocations[shan2().id] >= 1);
    h.check("已完成订单不保留分配", oDone2.status === "done" && Object.keys(oDone2.allocations).length === 0);

    // 刷新后流转拦截与撤销行为一致
    app2.transitionOrder(oPending2, "done");
    h.check("刷新后非法跳跃仍被拦截", oPending2.status === "pending");
    const trimEvent2 = app2.state.replans.find((e) => e.id === trimEvent.id);
    app2.undoLastReplan(); // 仍放不回（库存3，制作中占用）
    h.check("刷新后撤销仍按锁定量拒绝", !trimEvent2.undoneAt);
    shan2().quantity = 8;
    app2.undoLastReplan();
    h.check("刷新后补库存重试撤销成功", trimEvent2.undoneAt !== undefined);
    h.checkProblems("刷新后撤销记录无虚报", h.findUndoLies(app2, trimEvent2));

    h.checkProblems("刷新后无库存超用", h.findOverUse(app2));
  }
};
