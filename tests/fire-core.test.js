/*
 * FireCore 單元測試（純 Node，不需要安裝任何套件）
 * 執行：node tests/fire-core.test.js
 *
 * 做法：從 index.html 抽出 <script id="fire-core"> 這段，放進 vm 沙盒執行，
 * 這樣網頁還是單一 HTML 檔，測試跑的也是同一份程式碼。
 */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var assert = require("assert");

var html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
var match = html.match(/<script id="fire-core">([\s\S]*?)<\/script>/);
if(!match) throw new Error("index.html 裡找不到 <script id=\"fire-core\">");
var sandbox = {};
vm.createContext(sandbox);
vm.runInContext(match[1], sandbox);
var C = sandbox.FireCore;

var passed = 0;
var failed = 0;
function test(name, fn){
  try{
    fn();
    passed++;
  }catch(e){
    failed++;
    console.error("✗ " + name);
    console.error("  " + (e && e.message));
  }
}
/** vm 沙盒裡的物件跟這邊的原型不同，先轉成一般 JSON 物件再比 */
function plain(x){
  return JSON.parse(JSON.stringify(x));
}
function near(a, b, eps){
  assert.ok(Math.abs(a - b) <= (eps || 1e-9), a + " 跟 " + b + " 差太多");
}

// ---------- 有效報酬 ----------

test("effectiveReturn：不借錢就是底層報酬", function(){
  near(C.effectiveReturn(0.08, 1, 0.04), 0.08);
});
test("effectiveReturn：槓桿 1.5、8% 底層、4% 借款 = 10%", function(){
  // 手算：0.08 + 0.5 乘以 (0.08 - 0.04) = 0.10
  near(C.effectiveReturn(0.08, 1.5, 0.04), 0.10);
});
test("effectiveReturn：槓桿 2、借款利率高於報酬會變差", function(){
  // 手算：0.03 + 1 乘以 (0.03 - 0.06) = 0
  near(C.effectiveReturn(0.03, 2, 0.06), 0);
});
test("effectiveReturn：跟 L 乘以 r 減 (L-1) 乘以 i 相等", function(){
  [[0.08, 1.3, 0.04], [-0.1, 2, 0.05], [0.12, 1.7, 0.02]].forEach(function(x){
    near(C.effectiveReturn(x[0], x[1], x[2]), x[1] * x[0] - (x[1] - 1) * x[2]);
  });
});

// ---------- 目標金額 ----------

test("targetAmount：每月 4000、25 倍 = 1,200,000", function(){
  assert.strictEqual(C.targetAmount(4000, 25), 1200000);
});
test("targetAmount：每月 4000、17 倍 = 816,000；33 倍 = 1,584,000", function(){
  assert.strictEqual(C.targetAmount(4000, 17), 816000);
  assert.strictEqual(C.targetAmount(4000, 33), 1584000);
});
test("倍數設定沒有被改動", function(){
  assert.deepStrictEqual(plain(C.MULTIPLES.map(function(m){ return m.mult; })), [15, 17, 25, 33]);
});

// ---------- 幾年到 ----------

test("yearsToTarget：預設值（20 萬、每年 1 萬、8%）25 倍要 19 年", function(){
  assert.strictEqual(C.yearsToTarget(200000, 10000, 0.08, 1200000), 19);
});
test("yearsToTarget：已達標回傳 0", function(){
  assert.strictEqual(C.yearsToTarget(2000000, 0, 0.08, 1200000), 0);
  assert.strictEqual(C.yearsToTarget(1200000, 0, 0.08, 1200000), 0);
});
test("yearsToTarget：目標 0 或負數視為已達標", function(){
  assert.strictEqual(C.yearsToTarget(0, 0, 0.08, 0), 0);
});
test("yearsToTarget：0% 報酬只靠存錢，剛好第 60 年", function(){
  assert.strictEqual(C.yearsToTarget(0, 20000, 0, 1200000), 60);
});
test("yearsToTarget：超過 60 年回傳 null", function(){
  assert.strictEqual(C.yearsToTarget(0, 19999, 0, 1200000), null);
  assert.strictEqual(C.yearsToTarget(0, 0, 0.08, 1200000), null);
});
test("yearsToTarget：可以自訂上限", function(){
  assert.strictEqual(C.yearsToTarget(0, 1000, 0, 100000, 200), 100);
});
test("yearsToTarget：有效報酬低於 -100% 時資產歸零，不會負負得正", function(){
  // 舊版會算出 V 正負震盪；現在每年歸零後只剩當年投入
  assert.strictEqual(C.yearsToTarget(200000, 10000, -1.3, 1200000), null);
  assert.strictEqual(C.stepYear(200000, 10000, -1.3), 10000);
  // 投入本身就超過目標時，第 1 年就到
  assert.strictEqual(C.yearsToTarget(200000, 1300000, -1.3, 1200000), 1);
});
test("yearsToTarget：浮點誤差不會讓剛好達標的那年漏算", function(){
  // 30000 每年 +11000，5% 報酬，第 8 年精確值是 15294859361/102400
  var target = 15294859361 / 102400;
  assert.strictEqual(C.yearsToTarget(30000, 11000, 0.05, target), 8);
});

// ---------- 跟 Python 獨立參考實作比對 ----------

test("跟 tests/reference.py 的精確計算結果一致（500 組）", function(){
  var cases = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "reference-cases.json"), "utf8"));
  assert.ok(cases.length >= 500);
  var bad = [];
  cases.forEach(function(c){
    // 模擬網頁：百分比除以 100、金額相加、目標 = 月支出 乘以 12 乘以 倍數
    var eff = C.effectiveReturn(c.baseReturn / 100, c.leverage, c.loanRate / 100);
    var target = C.targetAmount(c.retireExpense, c.mult);
    var y = C.yearsToTarget(c.asset + c.lump, c.annual, eff, target);
    if(Math.abs(eff - c.effectiveReturn) > 1e-12) bad.push(c.name + " 有效報酬 " + eff + " 應為 " + c.effectiveReturn);
    if(y !== c.expectedYears) bad.push(c.name + " 年數 " + y + " 應為 " + c.expectedYears);
  });
  assert.deepStrictEqual(bad, []);
});

// ---------- 逐年資產 ----------

test("projectYears：第 1 年 = 20 萬乘以 1.08 加 1 萬 = 226,000", function(){
  var targets = C.MULTIPLES.map(function(m){ return { mult: m.mult, target: C.targetAmount(4000, m.mult) }; });
  var p = C.projectYears(200000, 10000, 0.08, targets);
  near(p.rows[0].value, 226000, 1e-6);
  near(p.rows[1].value, 254080, 1e-6);
});
test("projectYears：跨過倍數的年份跟 yearsToTarget 一致", function(){
  var targets = C.MULTIPLES.map(function(m){ return { mult: m.mult, target: C.targetAmount(4000, m.mult) }; });
  var p = C.projectYears(200000, 10000, 0.08, targets);
  C.MULTIPLES.forEach(function(m){
    var y = C.yearsToTarget(200000, 10000, 0.08, C.targetAmount(4000, m.mult));
    var row = p.rows.filter(function(r){ return r.crossed.indexOf(m.mult) >= 0; })[0];
    assert.strictEqual(row.year, y, m.mult + " 倍");
  });
});
test("projectYears：至少列 30 年，全部跨過後停", function(){
  var targets = [{ mult: 25, target: 1200000 }];
  assert.strictEqual(C.projectYears(200000, 10000, 0.08, targets).rows.length, 30);
  assert.strictEqual(C.projectYears(0, 0, 0.08, targets).rows.length, 60);
  assert.strictEqual(C.projectYears(100, 0, 0.5, [{ mult: 25, target: 1 }]).rows.length, 30);
});
test("projectYears：現在就已達標的倍數放在 startCrossed", function(){
  var targets = [{ mult: 15, target: 720000 }, { mult: 25, target: 1200000 }];
  var p = C.projectYears(1000000, 0, 0.08, targets);
  assert.deepStrictEqual(plain(p.startCrossed), [15]);
  assert.deepStrictEqual(plain(p.rows[1].crossed), []);   // 1.08^2 = 1.1664，還沒到 1.2
  assert.deepStrictEqual(plain(p.rows[2].crossed), [25]); // 1.08^3 = 1.2597，第 3 年跨過
});

// ---------- 敏感度 ----------

test("sensitivity：預設值的四個情境", function(){
  var res = C.sensitivity({ r: 0.08, i: 0.04, L: 1, startValue: 200000, annual: 10000, retireExpense: 4000 }, 5000);
  // 由 Python 精確計算：19、16、16、17 年
  assert.deepStrictEqual(plain(res.map(function(s){ return s.years; })), [19, 16, 16, 17]);
});
test("diffText：各種比較文字", function(){
  assert.strictEqual(C.diffText(19, 19), "跟現在沒差");
  assert.strictEqual(C.diffText(19, 16), "比現在少 3 年");
  assert.strictEqual(C.diffText(16, 19), "比現在多 3 年");
  assert.strictEqual(C.diffText(null, 19), "無法比較");
  assert.strictEqual(C.diffText(19, null), "無法比較");
});

// ---------- 幣別 ----------

test("幣別換算：EUR 與 TWD 互轉", function(){
  assert.strictEqual(C.toDisplay(100, "EUR", 36.78), 100);
  near(C.toDisplay(100, "TWD", 36.78), 3678, 1e-9);
  near(C.toOther(100, "EUR", 36.78), 3678, 1e-9);
  assert.strictEqual(C.toOther(100, "TWD", 36.78), 100);
  near(C.fromDisplay(3678, "TWD", 36.78), 100, 1e-9);
  assert.strictEqual(C.fromDisplay(100, "EUR", 36.78), 100);
});

// ---------- 格式化 ----------

test("formatAmount：千分位、四捨五入、不會出現 -0", function(){
  assert.strictEqual(C.formatAmount(1200000), "1,200,000");
  assert.strictEqual(C.formatAmount(1234.5), "1,235");
  assert.strictEqual(C.formatAmount(-0.4), "0");
});
test("formatPercent：一位小數、不會出現 -0.0%", function(){
  assert.strictEqual(C.formatPercent(0.08), "8.0%");
  assert.strictEqual(C.formatPercent(0.1), "10.0%");
  assert.strictEqual(C.formatPercent(-0.0004), "0.0%");
  assert.strictEqual(C.formatPercent(-1.3), "-130.0%");
});
test("formatYears／formatYearsTo", function(){
  assert.strictEqual(C.formatYears(19), "19 年");
  assert.strictEqual(C.formatYears(null), "60 年以上");
  assert.strictEqual(C.formatYears(0), "已達標");
  assert.strictEqual(C.formatYearsTo(19), "19 年到");
  assert.strictEqual(C.formatYearsTo(null), "60 年以上到");
  assert.strictEqual(C.formatYearsTo(0), "已經達標");
});

// ---------- 輸入驗證 ----------

test("parseField：空白", function(){
  assert.deepStrictEqual(plain(C.parseField("", C.FIELD_RULES.asset)), { ok: true, value: 0 });
  assert.strictEqual(C.parseField("", C.FIELD_RULES.retireExpense).ok, false);
  assert.strictEqual(C.parseField("  ", C.FIELD_RULES.baseReturn).ok, false);
});
test("parseField：負數與 0", function(){
  assert.strictEqual(C.parseField("-1", C.FIELD_RULES.asset).error, "不能是負數");
  assert.strictEqual(C.parseField("0", C.FIELD_RULES.retireExpense).error, "要大於 0");
  assert.strictEqual(C.parseField("0", C.FIELD_RULES.rate).error, "要大於 0");
  assert.deepStrictEqual(plain(C.parseField("0", C.FIELD_RULES.annual)), { ok: true, value: 0 });
});
test("parseField：報酬率範圍 -50 到 50", function(){
  assert.deepStrictEqual(plain(C.parseField("-2", C.FIELD_RULES.baseReturn)), { ok: true, value: -2 });
  assert.strictEqual(C.parseField("-51", C.FIELD_RULES.baseReturn).error, "最低 -50");
  assert.strictEqual(C.parseField("51", C.FIELD_RULES.baseReturn).error, "最高 50");
  assert.strictEqual(C.parseField("31", C.FIELD_RULES.loanRate).error, "最高 30");
});
test("parseField：極大值、Infinity、非數字", function(){
  assert.strictEqual(C.parseField("1e309", C.FIELD_RULES.asset).ok, false);
  assert.strictEqual(C.parseField("1e14", C.FIELD_RULES.asset).ok, false);
  assert.strictEqual(C.parseField("abc", C.FIELD_RULES.asset).ok, false);
  assert.deepStrictEqual(plain(C.parseField("1e12", C.FIELD_RULES.asset)), { ok: true, value: 1e12 });
});

// ---------- localStorage 清理 ----------

test("sanitizeState：壞資料回預設值", function(){
  var d = C.defaultState();
  assert.deepStrictEqual(plain(C.sanitizeState(null)), plain(d));
  assert.deepStrictEqual(plain(C.sanitizeState("x")), plain(d));
  var s = C.sanitizeState({ currency: "USD", rate: -3, assetEUR: -100, retireExpenseEUR: 0, baseReturn: "8", retireTouched: "yes" });
  assert.strictEqual(s.currency, "EUR");
  assert.strictEqual(s.rate, d.rate);
  assert.strictEqual(s.assetEUR, d.assetEUR);
  assert.strictEqual(s.retireExpenseEUR, d.retireExpenseEUR);
  assert.strictEqual(s.baseReturn, d.baseReturn);
  assert.strictEqual(s.retireTouched, false);
});
test("sanitizeState：槓桿夾在 1.0 到 2.0（舊版只夾下限）", function(){
  assert.strictEqual(C.sanitizeState({ leverage: 5 }).leverage, 2);
  assert.strictEqual(C.sanitizeState({ leverage: 0.3 }).leverage, 1);
  assert.strictEqual(C.sanitizeState({ leverage: 1.5 }).leverage, 1.5);
});
test("sanitizeState：保留合法的舊設定", function(){
  var s = C.sanitizeState({ currency: "TWD", rate: 35, assetEUR: 1000, baseReturn: -3, leverage: 1.3, retireTouched: true });
  assert.strictEqual(s.currency, "TWD");
  assert.strictEqual(s.rate, 35);
  assert.strictEqual(s.assetEUR, 1000);
  assert.strictEqual(s.baseReturn, -3);
  assert.strictEqual(s.leverage, 1.3);
  assert.strictEqual(s.retireTouched, true);
});

console.log((failed ? "失敗" : "全部通過") + "：" + passed + " 通過，" + failed + " 失敗");
process.exit(failed ? 1 : 0);
