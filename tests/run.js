// 回归测试入口：node tests/run.js（或 npm test）
const harness = require("./harness");

const suites = ["editor", "orders", "inventory", "replan", "undo", "persistence", "defects"].map((name) =>
  require(`./suites/${name}.test.js`)
);

console.log("活字排版工坊 · 自动化回归测试\n");

for (const suite of suites) {
  console.log(`■ ${suite.name}`);
  try {
    suite.run(harness);
  } catch (error) {
    harness.check(`套件「${suite.name}」执行异常`, false, error.stack);
  }
  console.log("");
}

const { pass, fail, failures } = harness.results;
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
if (fail > 0) {
  console.log("失败项：");
  failures.forEach((name) => console.log(`  - ${name}`));
}
process.exit(fail > 0 ? 1 : 0);
