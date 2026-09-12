// 原有编辑器流程：字库维护、落字、草稿、导出、超量提示
module.exports = {
  name: "原有编辑器流程",
  run(h) {
    const b = h.boot();
    const { app, $ } = b;

    h.check("默认进入排版工坊视图", app.state.view === "editor");
    h.check("初始库存6枚", app.state.inventory.length === 6);

    // 落字与取消
    const shan = app.state.inventory[0];
    app.placeType(0, 0, shan.id);
    app.placeType(0, 1, shan.id);
    h.check("落字2枚", app.state.placements.length === 2);
    app.placeType(0, 0, shan.id);
    h.check("再次点击取消落字", app.state.placements.length === 1);

    // 超量落字 → 状态条告警（编辑器允许超出但明确提示）
    app.placeType(0, 0, shan.id);
    app.placeType(0, 2, shan.id);
    app.placeType(0, 3, shan.id);
    app.placeType(0, 4, shan.id); // 山 库存4 → 版面5
    h.check("超量时状态条告警", $("#shortageBadge").textContent.includes("超量"), `状态条实际显示：${$("#shortageBadge").textContent}`);

    // 字库维护：正常入库 + 缺字段拒绝
    $("#charInput").value = "云";
    $("#styleInput").value = "宋体旧字";
    $("#sizeInput").value = "26";
    $("#quantityInput").value = "5";
    b.fireSubmit("#typeForm");
    h.check("新字模已入库", app.state.inventory.some((i) => i.char === "云" && i.quantity === 5));
    const countBefore = app.state.inventory.length;
    $("#charInput").value = "";
    $("#styleInput").value = "";
    b.fireSubmit("#typeForm");
    h.check("缺字/风格时拒绝入库并提示", app.state.inventory.length === countBefore && b.toast().type === "warn", `toast：${b.toast().text}`);

    // 草稿保存与载入
    $("#workTitle").value = "测试小笺";
    b.fireClick("#saveDraftBtn");
    h.check("草稿已保存", app.state.drafts.length === 1);
    const draftId = app.state.drafts[0].id;
    const placedBefore = app.state.placements.length;
    app.state.placements = [];
    app.renderAll();
    b.fireClick("#draftList", {
      target: { closest: (sel) => (sel === "[data-load-draft]" ? { dataset: { loadDraft: draftId } } : null) }
    });
    h.check("载入草稿恢复落字", app.state.placements.length === placedBefore);

    // 清空版面
    b.fireClick("#clearBoardBtn");
    h.check("清空版面", app.state.placements.length === 0);

    // 导出预览图（canvas 桩）
    let ok = true;
    try {
      b.fireClick("#exportBtn");
    } catch (e) {
      ok = false;
    }
    h.check("导出预览图不报错", ok && b.toast().text.includes("导出"), b.toast().text);

    // 删除字模同步清理版面
    const yun = app.state.inventory.find((i) => i.char === "云");
    app.placeType(0, 0, yun.id);
    app.deleteType(yun.id);
    h.check("删除字模后版面同步清理", app.state.placements.every((p) => p.typeId !== yun.id));

    h.checkProblems("编辑器流程无库存超用", h.findOverUse(app));
  }
};
