// 库存升降与字模移除：自动重核算、削减也生成带前后数量的调整记录
module.exports = {
  name: "库存升降与重核算",
  run(h) {
    const b = h.boot();
    const { app } = b;
    const shan = () => app.state.inventory.find((i) => i.char === "山");
    const shanOf = (o) => o.allocations[shan().id] || 0;

    const oL = h.createOrderViaForm(b, { title: "L低", text: "山山山山", priority: "low" });
    h.check("L 分齐4枚", shanOf(oL) === 4);

    // 库存下调 → 削减记录（时间、原因、前后数量）
    let cursor = app.state.replans.length;
    let snap = h.snapshotAllocations(app);
    app.changeTypeQuantity(shan().id, -1); // 4→3
    app.changeTypeQuantity(shan().id, -1); // 3→2
    h.check("下调后 L 被削到2", shanOf(oL) === 2, `实际 ${shanOf(oL)}`);
    h.check("下调生成了调整记录", app.state.replans.length === cursor + 2, `新增记录 ${app.state.replans.length - cursor} 条`);
    const trimEvent = app.state.replans[0];
    h.check(
      "削减记录含原因与前后数量 3→2",
      trimEvent.reason.includes("库存下调") && trimEvent.changes[0].items.some((i) => i.before === 3 && i.after === 2),
      JSON.stringify(trimEvent.changes[0]?.items)
    );
    h.checkProblems("下调改动都有日志", h.findLogProblems(app, cursor, snap));

    // 库存回升 → 重排补齐
    cursor = app.state.replans.length;
    snap = h.snapshotAllocations(app);
    app.changeTypeQuantity(shan().id, 1); // 2→3
    app.changeTypeQuantity(shan().id, 1); // 3→4
    h.check("回升后 L 补回4", shanOf(oL) === 4);
    h.check("回升事件记录原因", app.state.replans[0].reason.includes("库存回升"), app.state.replans[0].reason);
    h.checkProblems("回升改动都有日志", h.findLogProblems(app, cursor, snap));

    // 字模移除 → 削减记录（含已删字模标签）
    const yue = app.state.inventory.find((i) => i.char === "月");
    const oY = h.createOrderViaForm(b, { title: "Y月", text: "月月", priority: "medium" });
    h.check("月字订单分到2枚", oY.allocations[yue.id] === 2);
    cursor = app.state.replans.length;
    app.deleteType(yue.id);
    h.check("字模已移除", !app.state.inventory.some((i) => i.char === "月"));
    h.check("Y 的月字分配被削减", !oY.allocations[yue.id]);
    const removeEvent = app.state.replans[0];
    h.check(
      "移除事件记录字模标签与前后数量",
      removeEvent.reason.includes("移除字模") && removeEvent.changes[0].items.some((i) => i.char === "月" && i.before === 2 && i.after === 0),
      JSON.stringify(removeEvent.changes[0]?.items)
    );
    h.check("移除后 Y 显示真实缺口", app.computeShortages(oY).some((e) => e.char === "月" && e.missing === 2));
    h.check("移除改动有日志", app.state.replans.length > cursor);

    // 每一步都无超用
    h.checkProblems("库存变动全程无超用", h.findOverUse(app));
  }
};
