/*
 * FIRE 計算器的計算核心：全部是純函式，不碰 DOM。
 * 公式的數學定義見 docs/formulas.md。
 *
 * 瀏覽器：index.html 用 <script src="fire-core.js"> 載入後掛在 window.FireCore。
 * Node：require("./fire-core.js") 取得同一組函式，給單元測試用。
 */
(function(root, factory){
  "use strict";
  var api = factory();
  if(typeof module === "object" && module.exports) module.exports = api;
  else root.FireCore = api;
})(typeof self !== "undefined" ? self : this, function(){
  "use strict";

  /** 年數模擬的上限，超過就顯示「60 年以上」 */
  var YEAR_CAP = 60;

  /** 比較「資產是否達標」時的相對容忍度，避免浮點誤差讓剛好達標的那年被算成沒到 */
  var REL_EPSILON = 1e-9;

  /** 四種提領倍數：目標金額 = 退休後年支出 乘以 倍數 */
  var MULTIPLES = [
    { key: "15", label: "CLEC 最低 15 倍", mult: 15 },
    { key: "17", label: "清流君動態提領約 17 倍", mult: 17 },
    { key: "25", label: "清流君 4% 法則 25 倍", mult: 25 },
    { key: "33", label: "CLEC 保守 33 倍（提 3%）", mult: 33 }
  ];

  /** 「報酬率換一下」表格用的底層報酬率 */
  var TABLE2_RATES = [0.06, 0.08, 0.10, 0.12];

  /** 預設匯率：1 EUR 兌多少 TWD */
  var DEFAULT_RATE = 36.78;

  /** 槓桿滑桿範圍 */
  var LEVERAGE_MIN = 1.0;
  var LEVERAGE_MAX = 2.0;

  /**
   * 各欄位的驗證規則
   * required：空白時是否算錯；空白且非必填就當 0
   * min／max：允許範圍；minExclusive 代表必須大於 min
   */
  var FIELD_RULES = {
    rate:          { required: true,  min: 0,   minExclusive: true, max: 100000 },
    asset:         { required: false, min: 0,   max: 1e13 },
    curExpense:    { required: true,  min: 0,   minExclusive: true, max: 1e11 },
    retireExpense: { required: true,  min: 0,   minExclusive: true, max: 1e11 },
    annual:        { required: false, min: 0,   max: 1e12 },
    lump:          { required: false, min: 0,   max: 1e13 },
    baseReturn:    { required: true,  min: -50, max: 50 },
    loanRate:      { required: true,  min: 0,   max: 30 }
  };

  /**
   * 有效報酬（槓桿後，對自有資金的年報酬）
   * = 底層報酬 + (槓桿倍數 - 1) 乘以 (底層報酬 - 借款利率)
   * 等同 L 乘以 r 減去 (L - 1) 乘以 i。全部用小數，例如 8% 傳 0.08。
   */
  function effectiveReturn(r, leverage, loanRate){
    return r + (leverage - 1) * (r - loanRate);
  }

  /** 目標金額 = 每月支出 乘以 12 乘以 倍數 */
  function targetAmount(monthlyExpense, mult){
    return monthlyExpense * 12 * mult;
  }

  /** 資產是否已達標（含浮點容忍度） */
  function hasReached(value, target){
    return value >= target - REL_EPSILON * Math.max(1, Math.abs(target));
  }

  /**
   * 過一年：先用有效報酬滾一年，年底再投入 annual。
   * 有效報酬低於 -100% 時（高槓桿遇大跌）資產最多歸零，不會變成負數再翻正。
   */
  function stepYear(value, annual, eff){
    return Math.max(0, value * (1 + eff)) + annual;
  }

  /**
   * 幾年後資產會達到 target。
   * 已經達標回傳 0；超過 cap 年還到不了回傳 null。
   */
  function yearsToTarget(startValue, annual, eff, target, cap){
    if(cap === undefined) cap = YEAR_CAP;
    if(hasReached(startValue, target)) return 0;
    var v = startValue;
    for(var n = 1; n <= cap; n++){
      v = stepYear(v, annual, eff);
      if(hasReached(v, target)) return n;
    }
    return null;
  }

  /**
   * 逐年資產表。
   * targets：[{ mult, target }]；回傳每年的資產與當年新跨過的倍數。
   * 至少列 minYears 年；全部倍數都跨過後就停，最多 cap 年。
   * startCrossed：第 0 年（現在）就已經達標的倍數。
   */
  function projectYears(startValue, annual, eff, targets, minYears, cap){
    if(minYears === undefined) minYears = 30;
    if(cap === undefined) cap = YEAR_CAP;
    var sorted = targets.slice().sort(function(a, b){ return a.mult - b.mult; });
    var crossed = {};
    var startCrossed = [];
    sorted.forEach(function(t){
      if(hasReached(startValue, t.target)){
        crossed[t.mult] = true;
        startCrossed.push(t.mult);
      }
    });
    var rows = [];
    var v = startValue;
    for(var n = 1; n <= cap; n++){
      v = stepYear(v, annual, eff);
      var newly = [];
      sorted.forEach(function(t){
        if(!crossed[t.mult] && hasReached(v, t.target)){
          crossed[t.mult] = true;
          newly.push(t.mult);
        }
      });
      rows.push({ year: n, value: v, crossed: newly });
      var allCrossed = sorted.every(function(t){ return crossed[t.mult]; });
      if(n >= minYears && allCrossed) break;
    }
    return { startCrossed: startCrossed, rows: rows };
  }

  /**
   * 敏感度分析（以 25 倍為準）。金額單位一律 EUR。
   * p：{ r, i, L, startValue, annual, retireExpense }，extraAnnual：「每年多投入」的金額
   */
  function sensitivity(p, extraAnnual){
    var eff = effectiveReturn(p.r, p.L, p.i);
    var target = targetAmount(p.retireExpense, 25);
    return [
      { key: "base",    years: yearsToTarget(p.startValue, p.annual, eff, target) },
      { key: "expense", years: yearsToTarget(p.startValue, p.annual, eff, targetAmount(p.retireExpense * 0.8, 25)) },
      { key: "return",  years: yearsToTarget(p.startValue, p.annual, effectiveReturn(p.r + 0.02, p.L, p.i), target) },
      { key: "annual",  years: yearsToTarget(p.startValue, p.annual + extraAnnual, eff, target) }
    ];
  }

  /** 跟目前設定比差幾年的文字 */
  function diffText(baseYears, years){
    if(years === null || baseYears === null) return "無法比較";
    var diff = years - baseYears;
    if(diff === 0) return "跟現在沒差";
    return diff > 0 ? "比現在多 " + diff + " 年" : "比現在少 " + (-diff) + " 年";
  }

  /** EUR 金額換成畫面幣別 */
  function toDisplay(amountEUR, currency, rate){
    return currency === "TWD" ? amountEUR * rate : amountEUR;
  }
  /** EUR 金額換成另一個幣別（對照用） */
  function toOther(amountEUR, currency, rate){
    return currency === "TWD" ? amountEUR : amountEUR * rate;
  }
  /** 畫面幣別的金額換回 EUR */
  function fromDisplay(amount, currency, rate){
    return currency === "TWD" ? amount / rate : amount;
  }

  /*
   * 去掉浮點數雜訊：只保留 12 位有效數字，跟 withdraw-calc 的 clean() 相同。
   * 只用在百分比：金額可能超過 12 位數（上限 10 兆），截掉會讓尾數變 0。
   * 例如 6% 底層、1.5 倍、1.5% 借款，有效報酬數學上是 8.25%，
   * 浮點數算出 0.08249999999999999，不先清掉的話四捨五入會變 8.2% 而不是 8.3%。
   */
  function clean(x){
    return Number(Number(x).toPrecision(12));
  }

  /** 金額取整數加千分位；避免出現「-0」 */
  function formatAmount(n){
    var v = Math.round(n);
    if(v === 0) v = 0;
    return v.toLocaleString("en-US");
  }
  /** 小數轉百分比，一位小數，例如 0.08 變成「8.0%」 */
  function formatPercent(frac){
    var v = Math.round(clean(frac * 1000)) / 10;
    if(v === 0) v = 0;
    return v.toFixed(1) + "%";
  }
  /** 年數文字：null 代表超過上限 */
  function formatYears(y){
    if(y === null) return YEAR_CAP + " 年以上";
    if(y === 0) return "已達標";
    return y + " 年";
  }
  /** 「X 年到」的版本，用在結論句與底部列 */
  function formatYearsTo(y){
    if(y === 0) return "已經達標";
    return formatYears(y) + "到";
  }

  /** 四捨五入到小數兩位（顯示在輸入框用） */
  function round2(n){
    return Math.round(n * 100) / 100;
  }

  /**
   * 解析輸入框文字。
   * 回傳 { ok: true, value } 或 { ok: false, error: "錯誤訊息" }
   * badInput：輸入框的 validity.badInput。瀏覽器看不懂框裡的字（例如打到一半的「1e」、
   * 用逗號當小數點的「1000,5」）時，value 會是空字串，不能當成「沒填」而默默變成 0。
   */
  function parseField(raw, rule, badInput){
    if(badInput) return { ok: false, error: "請填一個有效的數字" };
    var s = (raw === null || raw === undefined) ? "" : String(raw).trim();
    if(s === ""){
      if(rule.required) return { ok: false, error: "請填一個數字" };
      return { ok: true, value: 0 };
    }
    var v = Number(s);
    if(!isFinite(v)) return { ok: false, error: "請填一個有效的數字" };
    if(rule.minExclusive ? v <= rule.min : v < rule.min){
      if(rule.min === 0) return { ok: false, error: rule.minExclusive ? "要大於 0" : "不能是負數" };
      return { ok: false, error: "最低 " + rule.min };
    }
    if(rule.max !== undefined && v > rule.max){
      return { ok: false, error: "最高 " + rule.max.toLocaleString("en-US") };
    }
    return { ok: true, value: v };
  }

  /** 預設值；內部金額一律以 EUR 記帳 */
  function defaultState(){
    return {
      currency: "EUR",
      rate: DEFAULT_RATE,
      assetEUR: 200000,
      curExpenseEUR: 4000,
      retireExpenseEUR: 4000,
      retireTouched: false,
      lumpEUR: 0,
      annualEUR: 10000,
      baseReturn: 8,
      leverage: 1.0,
      loanRate: 4
    };
  }

  /**
   * 把 localStorage 讀到的東西清乾淨：型別不對、超出範圍就回預設值。
   * 槓桿會夾在 1.0 到 2.0 之間，跟滑桿一致。
   */
  function sanitizeState(saved){
    var s = defaultState();
    if(!saved || typeof saved !== "object") return s;
    function inRange(v, rule){
      return typeof v === "number" && isFinite(v) &&
        (rule.minExclusive ? v > rule.min : v >= rule.min) &&
        (rule.max === undefined || v <= rule.max);
    }
    if(saved.currency === "EUR" || saved.currency === "TWD") s.currency = saved.currency;
    if(inRange(saved.rate, FIELD_RULES.rate)) s.rate = saved.rate;
    // 金額存的是 EUR，但輸入時是用畫面幣別檢查範圍。在 TWD 模式、匯率很小時，
    // 合法的台幣金額換成 EUR 可能超過上限，所以 EUR 或台幣其中一邊在範圍內就保留
    [["assetEUR","asset"],["curExpenseEUR","curExpense"],["retireExpenseEUR","retireExpense"],
     ["lumpEUR","lump"],["annualEUR","annual"]].forEach(function(pair){
      var v = saved[pair[0]], rule = FIELD_RULES[pair[1]];
      if(inRange(v, rule) || (typeof v === "number" && inRange(v * s.rate, rule))) s[pair[0]] = v;
    });
    ["baseReturn", "loanRate"].forEach(function(k){
      if(inRange(saved[k], FIELD_RULES[k])) s[k] = saved[k];
    });
    if(typeof saved.retireTouched === "boolean") s.retireTouched = saved.retireTouched;
    if(typeof saved.leverage === "number" && isFinite(saved.leverage)){
      s.leverage = Math.min(LEVERAGE_MAX, Math.max(LEVERAGE_MIN, Math.round(saved.leverage * 10) / 10));
    }
    return s;
  }

  return {
    YEAR_CAP: YEAR_CAP,
    MULTIPLES: MULTIPLES,
    TABLE2_RATES: TABLE2_RATES,
    DEFAULT_RATE: DEFAULT_RATE,
    LEVERAGE_MIN: LEVERAGE_MIN,
    LEVERAGE_MAX: LEVERAGE_MAX,
    FIELD_RULES: FIELD_RULES,
    effectiveReturn: effectiveReturn,
    targetAmount: targetAmount,
    hasReached: hasReached,
    clean: clean,
    stepYear: stepYear,
    yearsToTarget: yearsToTarget,
    projectYears: projectYears,
    sensitivity: sensitivity,
    diffText: diffText,
    toDisplay: toDisplay,
    toOther: toOther,
    fromDisplay: fromDisplay,
    formatAmount: formatAmount,
    formatPercent: formatPercent,
    formatYears: formatYears,
    formatYearsTo: formatYearsTo,
    round2: round2,
    parseField: parseField,
    defaultState: defaultState,
    sanitizeState: sanitizeState
  };
});
