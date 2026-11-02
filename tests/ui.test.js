/*
 * 畫面層測試：用 Playwright 開真的瀏覽器操作 index.html。
 * 執行：node tests/ui.test.js
 *
 * 需要 Playwright 與 Chromium；沒有安裝時會印出「略過」並以 0 結束，
 * 不影響只想跑 fire-core.test.js 的人。
 */
"use strict";

var path = require("path");
var assert = require("assert");

var playwright;
try{
  playwright = require("playwright");
}catch(e){
  console.log("略過：找不到 playwright（npm i -D playwright 後可跑畫面測試）");
  process.exit(0);
}

var URL = "file://" + path.join(__dirname, "..", "index.html");

var tests = [];
function test(name, fn){ tests.push({ name: name, fn: fn }); }

/** 每個測試都從乾淨的 localStorage 開始 */
async function freshPage(browser, opts){
  var context = await browser.newContext(opts || {});
  var page = await context.newPage();
  var errors = [];
  page.on("pageerror", function(e){ errors.push(e.message); });
  page.on("console", function(m){ if(m.type() === "error") errors.push(m.text()); });
  await page.goto(URL);
  await page.evaluate(function(){ localStorage.clear(); });
  await page.reload();
  page._errors = errors;
  return page;
}

test("預設值：25 倍 19 年，沒有任何 JS 或 CSP 錯誤", async function(browser){
  var page = await freshPage(browser);
  assert.strictEqual(await page.textContent("#vWord"), "25 倍要存到 1,200,000 EUR，19 年到");
  assert.deepStrictEqual(page._errors, []);
  await page.context().close();
});

test("打到一半看不懂的數字（1e）不會默默當成 0", async function(browser){
  var page = await freshPage(browser);
  // 在 200000 後面多打一個 e，瀏覽器回報 badInput、value 變成空字串
  await page.focus("#asset");
  await page.keyboard.press("End");
  await page.keyboard.type("e");
  assert.strictEqual(await page.getAttribute("#asset", "aria-invalid"), "true");
  assert.strictEqual(await page.textContent("#asset-err"), "請填一個有效的數字");
  assert.strictEqual(await page.textContent("#vWord"), "有 1 個欄位要修正");
  // 結果維持上一次的有效值（20 萬），底部列還是 19 年，不是把資產當 0 的 31 年
  assert.strictEqual(await page.textContent("#bbYears"), "19 年到");
  // 補成合法的 200000e5（2e10）後錯誤消失並重算
  await page.keyboard.type("5");
  assert.strictEqual(await page.getAttribute("#asset", "aria-invalid"), null);
  assert.strictEqual(await page.textContent("#bbYears"), "已經達標");
  await page.context().close();
});

test("其他欄位有錯時改匯率，被覆寫的欄位錯誤提示一起清掉", async function(browser){
  var page = await freshPage(browser);
  await page.fill("#retireExpense", "");
  assert.strictEqual(await page.textContent("#vWord"), "有 1 個欄位要修正");
  await page.fill("#rate", "36");
  assert.strictEqual(await page.inputValue("#retireExpense"), "4000");
  assert.strictEqual(await page.getAttribute("#retireExpense", "aria-invalid"), null);
  assert.strictEqual(await page.isHidden("#retireExpense-err"), true);
  assert.strictEqual(await page.textContent("#vWord"), "25 倍要存到 1,200,000 EUR，19 年到");
  await page.context().close();
});

test("匯率本身填錯時，其他欄位照常，匯率錯誤保留", async function(browser){
  var page = await freshPage(browser);
  await page.fill("#rate", "0");
  assert.strictEqual(await page.textContent("#rate-err"), "要大於 0");
  await page.fill("#asset", "300000");
  assert.strictEqual(await page.getAttribute("#rate", "aria-invalid"), "true");
  await page.context().close();
});

test("TWD 模式匯率很小、金額很大，重新整理後數字還在", async function(browser){
  var page = await freshPage(browser);
  await page.click("#tabTWD");
  await page.fill("#rate", "0.01");
  await page.fill("#asset", "1000000000000");
  await page.reload();
  assert.strictEqual(await page.inputValue("#asset"), "1000000000000");
  assert.strictEqual(await page.inputValue("#rate"), "0.01");
  assert.deepStrictEqual(page._errors, []);
  await page.context().close();
});

test("極端輸入：最高報酬、最高槓桿、最大金額，畫面沒有 NaN 或 Infinity", async function(browser){
  var page = await freshPage(browser);
  await page.fill("#asset", "10000000000000");
  await page.fill("#retireExpense", "100000000000");
  await page.fill("#annual", "1000000000000");
  await page.fill("#baseReturn", "50");
  await page.click("#advDetails summary");
  await page.fill("#lump", "10000000000000");
  await page.fill("#loanRate", "0");
  await page.$eval("#leverage", function(el){ el.value = "2"; el.dispatchEvent(new Event("input")); });
  await page.click("#yearlyDetails summary");
  var text = await page.textContent("main");
  var bar = await page.textContent("#bottomBar");
  assert.ok(!/NaN|Infinity|∞|undefined/.test(text + bar), "畫面出現異常字串");
  assert.strictEqual(await page.textContent("#effDisplay"), "100.0%");
  assert.deepStrictEqual(page._errors, []);
  await page.context().close();
});

test("極端輸入：最差報酬加槓桿（低於 -100%）顯示歸零警告", async function(browser){
  var page = await freshPage(browser);
  await page.fill("#baseReturn", "-50");
  await page.click("#advDetails summary");
  await page.fill("#loanRate", "30");
  await page.$eval("#leverage", function(el){ el.value = "2"; el.dispatchEvent(new Event("input")); });
  assert.strictEqual(await page.textContent("#vWord"), "有效報酬低於 -100%，資產會歸零");
  assert.strictEqual(await page.textContent("#effDisplay"), "-130.0%");
  await page.context().close();
});

test("localStorage 被塞壞資料或無法使用，頁面照常顯示預設值", async function(browser){
  var page = await freshPage(browser);
  await page.evaluate(function(){ localStorage.setItem("fireCalcLeverage", "{not json"); });
  await page.reload();
  assert.strictEqual(await page.textContent("#vWord"), "25 倍要存到 1,200,000 EUR，19 年到");
  await page.evaluate(function(){
    localStorage.setItem("fireCalcLeverage", JSON.stringify({ assetEUR: "<img src=x onerror=alert(1)>", currency: "<b>" }));
  });
  await page.reload();
  assert.strictEqual(await page.inputValue("#asset"), "200000");
  assert.strictEqual(await page.textContent("[data-ccy-unit]"), "EUR");
  assert.deepStrictEqual(page._errors, []);
  await page.context().close();

  // 模擬無痕模式：localStorage 存取直接丟錯
  var context = await browser.newContext();
  await context.addInitScript(function(){
    Object.defineProperty(window, "localStorage", { get: function(){ throw new Error("blocked"); } });
  });
  var p2 = await context.newPage();
  var errs = [];
  p2.on("pageerror", function(e){ errs.push(e.message); });
  await p2.goto(URL);
  await p2.fill("#asset", "300000");
  assert.strictEqual(await p2.textContent("#bbYears"), "15 年到"); // 由 FireCore 算出：30 萬、每年 1 萬、8%
  assert.deepStrictEqual(errs, []);
  await context.close();
});

test("效能：連續輸入 200 次，每次重算都在 5ms 內", async function(browser){
  var page = await freshPage(browser);
  await page.click("#yearlyDetails summary");
  var ms = await page.evaluate(function(){
    var el = document.getElementById("asset");
    var t0 = performance.now();
    for(var k = 0; k < 200; k++){
      el.value = String(100000 + k * 1000);
      el.dispatchEvent(new Event("input"));
    }
    return (performance.now() - t0) / 200;
  });
  assert.ok(ms < 5, "平均每次 " + ms.toFixed(2) + "ms");
  await page.context().close();
});

test("手機寬度 375px 沒有橫向捲動", async function(browser){
  var page = await freshPage(browser, { viewport: { width: 375, height: 700 } });
  await page.click("#advDetails summary");
  await page.click("#yearlyDetails summary");
  var overflow = await page.evaluate(function(){
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  });
  assert.ok(overflow <= 0, "多出 " + overflow + "px");
  await page.context().close();
});

(async function(){
  var browser;
  try{
    browser = await playwright.chromium.launch();
  }catch(e){
    console.log("略過：Chromium 無法啟動（" + e.message.split("\n")[0] + "）");
    process.exit(0);
  }
  var passed = 0, failed = 0;
  for(var k = 0; k < tests.length; k++){
    try{
      await tests[k].fn(browser);
      passed++;
    }catch(e){
      failed++;
      console.error("✗ " + tests[k].name);
      console.error("  " + (e && e.message));
    }
  }
  await browser.close();
  console.log((failed ? "失敗" : "全部通過") + "：" + passed + " 通過，" + failed + " 失敗");
  process.exit(failed ? 1 : 0);
})();
