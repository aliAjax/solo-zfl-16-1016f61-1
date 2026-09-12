// 缺陷探测自检：证明测试基建能暴露 库存超用 / 日志缺失 / 撤销虚报 三类问题
// （这里故意注入坏状态，断言探测器以清晰信息报出；健康状态则不许误报）
module.exports = {
  name: "缺陷探测自检",
  run(h) {
    // --- 健康状态：三个探测器都不许误报 ---
    const healthy = h.boot();
    const { app } = healthy;
    const oA = h.createOrderViaForm(healthy, { title: "健康单", text: "山山", priority: "medium" });
    const cursor0 = app.state.replans.length;
    const snap0 = h.snapshotAllocations(app);
    app.changeTypeQuantity(app.state.inventory.find((i) => i.char === "山").id, 1);
    h.checkProblems("健康状态无超用误报", h.findOverUse(app));
    h.checkProblems("健康状态无日志缺失误报", h.findLogProblems(app, cursor0, snap0));
    const ev = app.state.replans[0];
    app.undoLastReplan();
    h.checkProblems("健康状态无撤销虚报误报", h.findUndoLies(app, ev));

    // --- 1. 库存超用：注入超量分配，探测器必须报出字模与数量 ---
    const bad1 = h.boot();
    const app1 = bad1.app;
    const shan1 = app1.state.inventory.find((i) => i.char === "山");
    const o1 = h.createOrderViaForm(bad1, { title: "超用单", text: "山山", priority: "medium" });
    o1.allocations[shan1.id] = 99; // 模拟缺陷：分配绕过上限
    const overProblems = h.findOverUse(app1);
    h.check(
      "探测器能报出库存超用（含字模与数量）",
      overProblems.some((p) => p.includes("山") && p.includes("99")),
      overProblems.join("\n") || "探测器没有任何输出"
    );

    // --- 2. 日志缺失：改动分配但不留记录，探测器必须报出订单 ---
    const bad2 = h.boot();
    const app2 = bad2.app;
    const shan2 = app2.state.inventory.find((i) => i.char === "山");
    const o2 = h.createOrderViaForm(bad2, { title: "漏记单", text: "山山", priority: "medium" });
    const cursor2 = app2.state.replans.length;
    const snap2 = h.snapshotAllocations(app2);
    o2.allocations[shan2.id] = 1; // 模拟缺陷：某代码路径改了分配却没写记录
    const logProblems = h.findLogProblems(app2, cursor2, snap2);
    h.check(
      "探测器能报出日志缺失（含订单名）",
      logProblems.some((p) => p.includes("漏记单")),
      logProblems.join("\n") || "探测器没有任何输出"
    );

    // --- 3. 撤销虚报：标记已撤销却不还原，探测器必须报出 ---
    const bad3 = h.boot();
    const app3 = bad3.app;
    const oL = h.createOrderViaForm(bad3, { title: "L低", text: "山山山山", priority: "low" });
    const oH = h.createOrderViaForm(bad3, { title: "H高", text: "山山山", priority: "high" });
    const evH = app3.state.replans[0]; // L 被收回的事件
    evH.undoneAt = new Date().toISOString(); // 模拟缺陷：标记撤销却没恢复 L 的分配
    const undoProblems = h.findUndoLies(app3, evH);
    h.check(
      "探测器能报出撤销虚报（含未还原订单）",
      undoProblems.some((p) => p.includes("L低")),
      undoProblems.join("\n") || "探测器没有任何输出"
    );
    h.check("虚报场景下 L 确实仍被占用（缺陷成立）", (oL.allocations[shanId(app3)] || 0) === 1);

    function shanId(a) {
      return a.state.inventory.find((i) => i.char === "山").id;
    }
  }
};
