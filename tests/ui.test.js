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
  // CI 會設 REQUIRE_UI=1：找不到 Playwright 就算失敗，不能默默略過
  console.log((process.env.REQUIRE_UI ? "失敗" : "略過") + "：找不到 playwright（npm i -D playwright 後可跑畫面測試）");
  process.exit(process.env.REQUIRE_UI ? 1 : 0);
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

test("修正：有效報酬 8.25% 顯示成 8.3%，不會被浮點誤差捨成 8.2%", async function(browser){
  var page = await freshPage(browser);
  await page.fill("#baseReturn", "6");
  await page.click("#advDetails summary");
  await page.fill("#loanRate", "1.5");
  await page.$eval("#leverage", function(el){ el.value = "1.5"; el.dispatchEvent(new Event("input")); });
  // 手算：6% + 0.5 乘以 (6% 減 1.5%) = 8.25%，四捨五入到一位是 8.3%
  assert.strictEqual(await page.textContent("#effDisplay"), "8.3%");
  await page.context().close();
});

test("無障礙：每個輸入欄位都有可讀的名稱", async function(browser){
  var page = await freshPage(browser);
  var missing = await page.evaluate(function(){
    return Array.prototype.slice.call(document.querySelectorAll("input")).filter(function(el){
      return !el.labels || !el.labels.length || !el.labels[0].textContent.trim();
    }).map(function(el){ return el.id; });
  });
  assert.deepStrictEqual(missing, []);
  await page.context().close();
});

test("無障礙：錯誤提示用 aria-live 區塊、跟欄位用 aria-describedby 連起來", async function(browser){
  var page = await freshPage(browser);
  var ids = ["rate", "asset", "curExpense", "retireExpense", "annual", "baseReturn", "lump", "loanRate"];
  for(var k = 0; k < ids.length; k++){
    var id = ids[k];
    assert.strictEqual(await page.getAttribute("#" + id, "aria-describedby"), id + "-err", id);
    assert.strictEqual(await page.getAttribute("#" + id + "-err", "aria-live"), "polite", id);
  }
  // 沒有錯時提示是空的、不占高度；出錯時顯示文字
  assert.strictEqual(await page.isHidden("#asset-err"), true);
  await page.fill("#asset", "-1");
  assert.strictEqual(await page.textContent("#asset-err"), "不能是負數");
  assert.strictEqual(await page.isVisible("#asset-err"), true);
  await page.fill("#asset", "1");
  assert.strictEqual(await page.isHidden("#asset-err"), true);
  await page.context().close();
});

test("鍵盤：只用 Tab、空白鍵、Enter、方向鍵就能操作全部功能", async function(browser){
  var page = await freshPage(browser);
  // Tab 依序走過的元件
  var order = [];
  for(var k = 0; k < 20; k++){
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(function(){
      var a = document.activeElement;
      return a.id || a.getAttribute("data-ccy") || a.getAttribute("data-rate") || a.tagName.toLowerCase();
    }));
  }
  ["tabEUR", "tabTWD", "rate", "asset", "curExpense", "retireExpense", "annual", "baseReturn", "6", "8", "10", "summary"].forEach(function(id, idx){
    assert.strictEqual(order[idx], id, "第 " + (idx + 1) + " 個 Tab 應該到 " + id + "，實際是 " + order[idx]);
  });

  // 空白鍵切幣別
  await page.focus("#tabTWD");
  await page.keyboard.press("Space");
  assert.strictEqual(await page.getAttribute("#tabTWD", "aria-pressed"), "true");
  assert.strictEqual(await page.inputValue("#asset"), "7356000");

  // Enter 按常用報酬率
  await page.focus(".rate-btn[data-rate='10']");
  await page.keyboard.press("Enter");
  assert.strictEqual(await page.inputValue("#baseReturn"), "10");

  // Enter 打開進階，方向鍵調槓桿
  await page.focus("#advDetails summary");
  await page.keyboard.press("Enter");
  assert.strictEqual(await page.evaluate(function(){ return document.getElementById("advDetails").open; }), true);
  await page.focus("#leverage");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  assert.strictEqual(await page.textContent("#leverageValue"), "1.2");
  assert.strictEqual(await page.getAttribute("#leverage", "aria-valuetext"), "1.2 倍");
  // 有效報酬 = 10% + 0.2 乘以 (10% 減 4%) = 11.2%
  assert.strictEqual(await page.textContent("#effDisplay"), "11.2%");
  assert.deepStrictEqual(page._errors, []);
  await page.context().close();
});

test("非法輸入：負數、空白、超過上限、打到一半的數字，畫面都不會壞", async function(browser){
  var page = await freshPage(browser);
  var cases = [["#asset", "-5"], ["#curExpense", ""], ["#retireExpense", "0"], ["#annual", "1e20"], ["#baseReturn", "-80"], ["#rate", "0"]];
  for(var k = 0; k < cases.length; k++){
    await page.fill(cases[k][0], cases[k][1]);
  }
  assert.strictEqual(await page.textContent("#vWord"), "有 6 個欄位要修正");
  var text = await page.textContent("main") + await page.textContent("#bottomBar");
  assert.ok(!/NaN|Infinity|undefined|null/.test(text), "畫面出現異常字串");
  // 結果維持上一次的有效值
  assert.strictEqual(await page.textContent("#bbYears"), "19 年到");
  assert.deepStrictEqual(page._errors, []);
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
    console.log((process.env.REQUIRE_UI ? "失敗" : "略過") + "：Chromium 無法啟動（" + e.message.split("\n")[0] + "）");
    process.exit(process.env.REQUIRE_UI ? 1 : 0);
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
