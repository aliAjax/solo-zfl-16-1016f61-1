// 撤销：完整恢复才标记、锁定不足不标记、部分恢复明示、补库存后重试成功
// 数量轨迹（山）：L低需4、M中需2、Z中需4，库存随步骤升降
module.exports = {
  name: "撤销失败与重试",
  run(h) {
    const b = h.boot();
    const { app } = b;
    const shan = () => app.state.inventory.find((i) => i.char === "山");
    const shanOf = (o) => o.allocations[shan().id] || 0;

    const oL = h.createOrderViaForm(b, { title: "L低", text: "山山山山", priority: "low" });
    const oM = h.createOrderViaForm(b, { title: "M中", text: "山山", priority: "medium" });
    h.check("初始重排后 M=2、L=2", shanOf(oM) === 2 && shanOf(oL) === 2, `M=${shanOf(oM)} L=${shanOf(oL)}`);

    // 完整恢复 → 标记已撤销且记录真实
    shan().quantity = 8;
    app.replanAllocations("「山」库存回升 4→8"); // M2，L4
    const evA = app.state.replans[0];
    h.check("回升后 L=4", shanOf(oL) === 4);
    app.undoLastReplan();
    h.check("完整恢复后事件标记已撤销", evA.undoneAt !== undefined);
    h.check("L 回到2、M 保持2", shanOf(oL) === 2 && shanOf(oM) === 2, `L=${shanOf(oL)} M=${shanOf(oM)}`);
    h.checkProblems("撤销记录无虚报", h.findUndoLies(app, evA));

    // 制造制作中锁定
    shan().quantity = 12;
    app.replanAllocations("「山」库存再回升 8→12"); // M2，L4
    app.transitionOrder(oM, "making");
    h.check("M 开工锁定2枚", oM.status === "making" && shanOf(oM) === 2);

    // 库存下调削减 L：12→5，L 4→3
    shan().quantity = 5;
    app.reconcileAllocations("「山」库存下调 12→5");
    h.check("下调后 L 被削到3", shanOf(oL) === 3, `L=${shanOf(oL)}`);
    const evC = app.state.replans[0];
    h.check("削减事件已记录且含前后数量", evC.reason.includes("库存下调") && evC.changes[0].items.some((i) => i.before === 4 && i.after === 3));

    // 锁定+库存不足 → 撤销被拒，不标记、不伪恢复
    app.undoLastReplan();
    h.check("无法完整恢复，事件未标撤销", !evC.undoneAt);
    h.check("L 保持3未被伪恢复", shanOf(oL) === 3);
    h.check("全部未恢复时不产生部分恢复标记", !evC.partialUndo);

    // 补库存后重试 → 成功
    shan().quantity = 6;
    app.renderAll();
    app.undoLastReplan();
    h.check("补库存后重试撤销成功", evC.undoneAt !== undefined && shanOf(oL) === 4, `L=${shanOf(oL)}`);
    h.checkProblems("重试后撤销记录无虚报", h.findUndoLies(app, evC));

    // 部分恢复：Z 入场分走库存，下调事件涉及两单
    const oZ = h.createOrderViaForm(b, { title: "Z中", text: "山山山山", priority: "medium" });
    h.check("Z 分到4、L 被挤到0", shanOf(oZ) === 4 && shanOf(oL) === 0, `Z=${shanOf(oZ)} L=${shanOf(oL)}`);
    shan().quantity = 8;
    app.replanAllocations("「山」库存回升 6→8"); // Z4，L2
    h.check("回升后 Z=4、L=2", shanOf(oZ) === 4 && shanOf(oL) === 2);
    shan().quantity = 5;
    app.reconcileAllocations("「山」库存下调 8→5"); // Z 4→3，L 2→0
    const evF = app.state.replans[0];
    h.check("下调事件涉及 Z 和 L 两单", evF.changes.length === 2, `实际 ${evF.changes.length} 单`);

    shan().quantity = 6;
    app.renderAll();
    app.undoLastReplan(); // Z 的4放得回，L 的2放不回 → 部分恢复
    h.check("部分恢复：Z 还原到4", shanOf(oZ) === 4, `Z=${shanOf(oZ)}`);
    h.check("部分恢复：L 仍0未还原", shanOf(oL) === 0, `L=${shanOf(oL)}`);
    h.check("部分恢复事件不标已撤销", !evF.undoneAt);
    h.check(
      "部分恢复标记列出未恢复的 L",
      evF.partialUndo && evF.partialUndo.unrestored.some((u) => u.orderId === oL.id),
      JSON.stringify(evF.partialUndo)
    );
    h.checkProblems("部分恢复记录无虚报", h.findUndoLies(app, evF));

    h.checkProblems("撤销流程全程无库存超用", h.findOverUse(app));
  }
};
