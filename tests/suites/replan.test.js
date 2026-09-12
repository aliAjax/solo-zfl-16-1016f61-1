// 优先级重排、同级按交期/创建先后、制作中保护、完成释放、不伪造满配
module.exports = {
  name: "优先级重排与制作中保护",
  run(h) {
    const b = h.boot();
    const { app } = b;
    const shan = () => app.state.inventory.find((i) => i.char === "山");
    const shanOf = (o) => o.allocations[shan().id] || 0;

    // 高优先级新单收回低优先级库存
    const oL = h.createOrderViaForm(b, { title: "L低", text: "山山山山", priority: "low" });
    h.check("L 先建分齐4枚", shanOf(oL) === 4);
    const oH = h.createOrderViaForm(b, { title: "H高", text: "山山山", priority: "high" });
    h.check("高优先级 H 分到3枚", shanOf(oH) === 3);
    h.check("L 被收回只剩1枚", shanOf(oL) === 1);
    const evH = app.state.replans[0];
    h.check(
      "收回事件记录 L 的前后 4→1",
      evH.changes.some((c) => c.orderId === oL.id && c.items.some((i) => i.before === 4 && i.after === 1)),
      JSON.stringify(evH.changes)
    );

    // 制作中保护：H 开工后，重排不再动它
    app.transitionOrder(oH, "making");
    const oM = h.createOrderViaForm(b, { title: "M中", text: "山山", priority: "medium" });
    h.check("重排后 H（制作中）仍是3枚", shanOf(oH) === 3);
    h.check("M 只分到剩余1枚", shanOf(oM) === 1);
    h.check("L 被挤到0", shanOf(oL) === 0);

    // 同级按交期：M 交期改早后排到 L 前
    app.updateOrderDue(oM, "2026-01-01");
    h.check("M 凭交期排前仍只有1（池子只有1）", shanOf(oM) === 1);
    shan().quantity = 5;
    app.replanAllocations("「山」库存回升 4→5");
    h.check("库存5时 M 补到2", shanOf(oM) === 2);
    h.check("库存5时 L 仍0（同级 M 交期更早）", shanOf(oL) === 0);

    // 编辑优先级触发重排：L 升高，收回 M
    app.updateOrderPriority(oL, "high");
    h.check("L 升高后分到2（同级 H 在制作中锁定3，池2）", shanOf(oL) === 2, `实际 ${shanOf(oL)}`);
    h.check("M 被收回", shanOf(oM) === 0);

    // 完成释放：H 完成后他单补齐，H 自身清空
    app.transitionOrder(oH, "done");
    h.check("H 完成后分配清空", Object.keys(oH.allocations).length === 0);
    h.check("释放后 L 补到4", shanOf(oL) === 4, `实际 ${shanOf(oL)}`);
    h.check("释放后 M 补到1（池子只剩1）", shanOf(oM) === 1, `实际 ${shanOf(oM)}`);
    h.check("完成释放事件已记录", app.state.replans[0].reason.includes("完成"), app.state.replans[0].reason);

    // 不伪造满配：需求远超库存，缺口真实
    const oZ = h.createOrderViaForm(b, { title: "Z中", text: "山".repeat(20), priority: "medium" });
    const zGot = Object.values(oZ.allocations).reduce((a, x) => a + x, 0);
    h.check("Z 需求20只占真实剩余", zGot <= 5 && app.computeShortages(oZ)[0]?.missing === 20 - zGot);

    h.checkProblems("重排全程无库存超用", h.findOverUse(app));
  }
};
