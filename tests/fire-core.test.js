/*
 * FireCore 單元測試（純 Node，不需要安裝任何套件）
 * 執行：node tests/fire-core.test.js
 *
 * 做法：直接 require 根目錄的 fire-core.js，跟網頁載入的是同一個檔案。
 */
"use strict";

var fs = require("fs");
var path = require("path");
var assert = require("assert");

var C = require(path.join(__dirname, "..", "fire-core.js"));

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

// ---------- 第二輪：更多極端輸入 ----------

test("parseField：瀏覽器回報 badInput 時算錯，不會默默變 0", function(){
  // 例如打到一半的「1e」或「1000,5」，瀏覽器給的 value 是空字串
  assert.strictEqual(C.parseField("", C.FIELD_RULES.asset, true).error, "請填一個有效的數字");
  assert.strictEqual(C.parseField("", C.FIELD_RULES.annual, true).ok, false);
  assert.deepStrictEqual(plain(C.parseField("", C.FIELD_RULES.asset, false)), { ok: true, value: 0 });
});
test("parseField：NaN、Infinity、十六進位以外的怪字串", function(){
  ["NaN", "Infinity", "-Infinity", "1,000", "--1", ".", "1e", "∞"].forEach(function(s){
    assert.strictEqual(C.parseField(s, C.FIELD_RULES.asset).ok, false, s);
  });
  // 極小值會被當成 0，必填且需大於 0 的欄位要擋下
  assert.strictEqual(C.parseField("1e-400", C.FIELD_RULES.retireExpense).ok, false);
  assert.strictEqual(C.parseField("1e-400", C.FIELD_RULES.rate).ok, false);
  // 上限邊界本身合法
  assert.strictEqual(C.parseField("50", C.FIELD_RULES.baseReturn).ok, true);
  assert.strictEqual(C.parseField("-50", C.FIELD_RULES.baseReturn).ok, true);
  assert.strictEqual(C.parseField("1e13", C.FIELD_RULES.asset).ok, true);
});
test("極端組合：所有金額都在上限，計算不會出現 NaN 或 Infinity", function(){
  var R = C.FIELD_RULES;
  var start = R.asset.max + R.lump.max;
  [[0.5, 2, 0], [-0.5, 2, 0.3], [0, 1, 0], [0.5, 1, 0.3]].forEach(function(x){
    var eff = C.effectiveReturn(x[0], x[1], x[2]);
    C.MULTIPLES.forEach(function(m){
      var target = C.targetAmount(R.retireExpense.max, m.mult);
      var y = C.yearsToTarget(start, R.annual.max, eff, target);
      assert.ok(y === null || (y >= 0 && y <= C.YEAR_CAP), "年數 " + y);
    });
    var proj = C.projectYears(start, R.annual.max, eff, [{ mult: 33, target: C.targetAmount(R.retireExpense.max, 33) }]);
    proj.rows.forEach(function(r){ assert.ok(isFinite(r.value) && r.value >= 0, "資產 " + r.value); });
  });
});
test("極端組合：最高報酬加最高槓桿，60 年也不會溢位", function(){
  // 有效報酬 = 0.5 + 1 乘以 0.5 = 100%，資產每年翻倍
  var eff = C.effectiveReturn(0.5, 2, 0);
  near(eff, 1);
  var proj = C.projectYears(1e13, 1e12, eff, [{ mult: 33, target: Number.MAX_VALUE }]);
  assert.strictEqual(proj.rows.length, C.YEAR_CAP);
  assert.ok(isFinite(proj.rows[C.YEAR_CAP - 1].value));
  assert.ok(C.formatAmount(proj.rows[C.YEAR_CAP - 1].value).length > 0);
});
test("極端組合：有效報酬剛好 -100%，每年只剩當年投入", function(){
  // 允許範圍內最差的組合：-0.5 + 1 乘以 (-0.5 - 0.3) = -1.3，會低於 -100%
  assert.ok(C.effectiveReturn(-0.5, 2, 0.3) < -1);
  assert.strictEqual(C.stepYear(500000, 10000, -1), 10000);
  assert.strictEqual(C.yearsToTarget(500000, 10000, -1, 1200000), null);
});
test("極端組合：月支出極小時目標也極小，現有資產就已達標", function(){
  assert.strictEqual(C.yearsToTarget(1, 0, 0, C.targetAmount(0.0001, 33)), 0);
  assert.strictEqual(C.yearsToTarget(0, 0.04, 0, C.targetAmount(0.0001, 33)), 1); // 目標 0.0396
});
test("sanitizeState：TWD 模式匯率很小時，合法的台幣金額重新整理後不會被重設", function(){
  // 匯率 0.01 時，台幣 1 兆換成 EUR 是 100 兆，超過 EUR 上限，但當初是用台幣檢查通過的
  var saved = { currency: "TWD", rate: 0.01, assetEUR: 1e12 / 0.01, annualEUR: 5e11 / 0.01 };
  var s = C.sanitizeState(saved);
  assert.strictEqual(s.assetEUR, 1e14);
  assert.strictEqual(s.annualEUR, 5e13);
  // 兩種幣別都超過上限才回預設值
  var bad = C.sanitizeState({ rate: 36.78, assetEUR: 1e15 });
  assert.strictEqual(bad.assetEUR, C.defaultState().assetEUR);
  // 負數不管匯率多少都不收
  assert.strictEqual(C.sanitizeState({ rate: 0.01, assetEUR: -5 }).assetEUR, C.defaultState().assetEUR);
});
test("sanitizeState：怪異的 JSON 不會出錯也不會污染原型", function(){
  var parsed = JSON.parse('{"__proto__":{"assetEUR":1},"constructor":1,"leverage":"NaN","rate":1e400}');
  var s = C.sanitizeState(parsed);
  assert.deepStrictEqual(plain(s), plain(C.defaultState()));
  assert.strictEqual(({}).assetEUR, undefined);
  assert.deepStrictEqual(plain(C.sanitizeState([1, 2, 3])), plain(C.defaultState()));
  assert.strictEqual(C.sanitizeState({ leverage: Infinity }).leverage, 1);
});

// ---------- 第三輪：公式對照 docs/formulas.md 與邊界值 ----------

test("公式 1 目標金額：每月 4000 乘以 12 乘以 15 = 720,000", function(){
  assert.strictEqual(C.targetAmount(4000, 15), 720000);
  // 隱含提領率 = 1 除以 倍數
  near(12 * 4000 / C.targetAmount(4000, 25), 0.04);
});
test("公式 2 有效報酬：6% 底層、1.5 倍、1.5% 借款 = 8.25%", function(){
  near(C.effectiveReturn(0.06, 1.5, 0.015), 0.0825, 1e-15);
});
test("公式 3 逐年資產：V1 = V0 乘以 (1 + g) 加 A", function(){
  assert.strictEqual(C.stepYear(200000, 10000, 0.08), 226000);
  assert.strictEqual(C.stepYear(100000, 50000, 0), 150000);
  near(C.stepYear(500000, 30000, -0.02), 520000, 1e-9);
});
test("公式 3 封閉解：6%、20 萬、每年 1 萬，第 17 年約 820,683", function(){
  var g = 0.06, n = 17, f = Math.pow(1 + g, n);
  var closed = 200000 * f + 10000 * (f - 1) / g;
  var v = 200000;
  for(var k = 0; k < n; k++) v = C.stepYear(v, 10000, g);
  near(v, closed, 1e-6);
  assert.strictEqual(C.formatAmount(v), "820,683");
});

test("修正：formatPercent 先去掉浮點雜訊，8.25% 顯示 8.3%（跟 withdraw-calc 的 pct 一致）", function(){
  // 0.06 + 0.5 乘以 0.045 在浮點數是 0.08249999999999999
  assert.ok(C.effectiveReturn(0.06, 1.5, 0.015) < 0.0825);
  assert.strictEqual(C.formatPercent(C.effectiveReturn(0.06, 1.5, 0.015)), "8.3%");
  assert.strictEqual(C.formatPercent(C.effectiveReturn(0.06, 1.9, 0.015)), "10.1%"); // 10.05%
  assert.strictEqual(C.formatPercent(C.effectiveReturn(0.08, 1.5, 0.035)), "10.3%"); // 10.25%
  assert.strictEqual(C.clean(0.1 + 0.2), 0.3);
});
test("修正：通膨換算用 (1 + 名目) 除以 (1 + 通膨) 減 1，直接減 2 個百分點會少算一年", function(){
  var real = (1.08 / 1.02) - 1;
  near(real, 0.0588235294, 1e-9);
  // 預設值、17 倍：直接減成 6% 是 17 年；精確的 5.88% 與畫面上填 5.9% 都是 18 年
  assert.strictEqual(C.yearsToTarget(200000, 10000, 0.06, 816000), 17);
  assert.strictEqual(C.yearsToTarget(200000, 10000, real, 816000), 18);
  assert.strictEqual(C.yearsToTarget(200000, 10000, 0.059, 816000), 18);
  // 槓桿時借款利率也一起換算，結果等於把名目有效報酬整個換算
  var pi = 0.02, r = 0.08, i = 0.04, L = 1.5;
  var rr = (1 + r) / (1 + pi) - 1, ii = (1 + i) / (1 + pi) - 1;
  near(C.effectiveReturn(rr, L, ii), (1 + C.effectiveReturn(r, L, i)) / (1 + pi) - 1, 1e-15);
});

test("邊界：0 年（上限設 0）只看現在是否已達標", function(){
  assert.strictEqual(C.yearsToTarget(1200000, 0, 0.08, 1200000, 0), 0);
  assert.strictEqual(C.yearsToTarget(1199999, 1e9, 0.08, 1200000, 0), null);
  var p = C.projectYears(0, 0, 0, [{ mult: 25, target: 1 }], 0, 0);
  assert.strictEqual(p.rows.length, 0);
});
test("邊界：0 報酬，年數 = (目標 減 V0) 除以 A 無條件進位", function(){
  // (750,000 減 100,000) 除以 50,000 = 13
  assert.strictEqual(C.yearsToTarget(100000, 50000, 0, 750000), 13);
  // 多 1 元就要第 14 年
  assert.strictEqual(C.yearsToTarget(100000, 50000, 0, 750001), 14);
  // 0 報酬又不投入，永遠到不了
  assert.strictEqual(C.yearsToTarget(100000, 0, 0, 750000), null);
});
test("邊界：負報酬，-2% 下 6 年到；-5% 的穩定點低於目標就到不了", function(){
  // V_n = 1,500,000 減 1,000,000 乘以 0.98^n，要 >= 600,000：0.98^n <= 0.9，n >= 5.2
  assert.strictEqual(C.yearsToTarget(500000, 30000, -0.02, 600000), 6);
  // -5%：V 會收斂到 10,000 除以 0.05 = 200,000，到不了 120 萬
  assert.strictEqual(C.yearsToTarget(500000, 10000, -0.05, 1200000), null);
  // 負報酬時資產每年遞減也不會變負數
  var v = 500000;
  for(var k = 0; k < 60; k++){ v = C.stepYear(v, 0, -0.5); assert.ok(v >= 0); }
});
test("邊界：極大金額（輸入上限）不溢位，4 年到", function(){
  // 10 兆、每年 1 兆、50%：16 兆、25 兆、38.5 兆、58.75 兆；目標 1000 億乘以 12 乘以 33 = 39.6 兆
  var target = C.targetAmount(C.FIELD_RULES.retireExpense.max, 33);
  assert.strictEqual(target, 3.96e13);
  assert.strictEqual(C.yearsToTarget(C.FIELD_RULES.asset.max, C.FIELD_RULES.annual.max, 0.5, target), 4);
  assert.strictEqual(C.formatAmount(target), "39,600,000,000,000");
});

console.log((failed ? "失敗" : "全部通過") + "：" + passed + " 通過，" + failed + " 失敗");
process.exit(failed ? 1 : 0);
