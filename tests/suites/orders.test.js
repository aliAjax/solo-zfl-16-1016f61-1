// 订单与版面共同占用、补齐清单、手工调整限流、状态流转
module.exports = {
  name: "订单与版面共同占用",
  run(h) {
    const b = h.boot();
    const { app, $ } = b;
    const shan = () => app.state.inventory.find((i) => i.char === "山");
    const shanOf = (o) => o.allocations[shan().id] || 0;

    // 版面先落 2 枚山，新订单只能分剩余
    app.placeType(0, 0, shan().id);
    app.placeType(0, 1, shan().id);
    const oA = h.createOrderViaForm(b, { title: "A单", text: "山山山山", priority: "high" });
    h.check("版面占用后订单只分到剩余2枚", shanOf(oA) === 2, `实际分到 ${shanOf(oA)}`);
    h.check(
      "补齐清单列出真实缺口（山缺2）",
      app.computeShortages(oA).some((e) => e.char === "山" && e.missing === 2),
      JSON.stringify(app.computeShortages(oA))
    );

    // 缺量不能开工
    app.transitionOrder(oA, "making");
    h.check("缺量时开工被拦截", oA.status === "pending" && b.toast().type === "warn", `toast：${b.toast().text}`);

    // 非法跳跃拦截
    app.transitionOrder(oA, "done");
    h.check("待排版→已完成被拦截", oA.status === "pending" && b.toast().text.includes("非法"), `toast：${b.toast().text}`);

    // 手工调整不能超用（可用 = 库存4 - 版面2 - 本单已分2 = 0）
    const input = { value: "" };
    app.adjustAllocation(oA, shan().id, "99", input);
    h.check("手工调整到99被钳回可用量", shanOf(oA) <= 2, `实际 ${shanOf(oA)}`);

    // 补货后重排分齐，可以开工
    app.changeTypeQuantity(shan().id, 1); // 4→5
    app.changeTypeQuantity(shan().id, 1); // 5→6
    h.check("补货重排后分齐4枚", shanOf(oA) === 4, `实际 ${shanOf(oA)}`);
    app.transitionOrder(oA, "making");
    h.check("分齐后可开工", oA.status === "making");

    // 完整流转：making→done→rework→making→done，历史完整
    app.transitionOrder(oA, "done");
    h.check("完成后分配已清空", Object.keys(oA.allocations).length === 0);
    app.transitionOrder(oA, "rework");
    h.check("已完成→返工", oA.status === "rework");
    app.transitionOrder(oA, "done");
    h.check("返工→已完成被拦截", oA.status === "rework");
    app.transitionOrder(oA, "making");
    h.check("返工→制作中", oA.status === "making");
    app.transitionOrder(oA, "done");
    h.check("返工闭环完成", oA.status === "done");
    h.check("每次变更都有历史记录", oA.history.length >= 5, `实际 ${oA.history.length} 条`);

    h.checkProblems("订单流程无库存超用", h.findOverUse(app));
  }
};
