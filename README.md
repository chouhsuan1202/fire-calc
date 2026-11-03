# FIRE 計算器（槓桿老師版）

**線上版：https://chouhsuan1202.github.io/fire-calc/**

退休要存多少、幾年存得到？這個小工具把六位中文理財圈「槓桿老師」的提領倍數放在一起比較，填六個數字就能一次看到所有答案。

[![畫面截圖](docs/screenshot.png)](https://chouhsuan1202.github.io/fire-calc/)

## 用途

* **輸入**：現有投資資產、現在每月支出、退休後每月支出、每年再投入、底層報酬率、幣別（EUR 或 TWD，可改匯率）。
* **進階**：一次投入（例如增貸進場的一筆錢）、借款利率、槓桿倍數 1.0 到 2.0。
* **輸出**：
  * 15、17、25、33 倍四個目標，各要存到多少、幾年到，並附另一幣別的對照金額。
  * 什麼最影響年數：退休支出少 20%、報酬多 2 個百分點、每年多投 5,000，各差幾年。
  * 報酬率 6%、8%、10%、12% 各要幾年。
  * 逐年資產表，標出哪一年跨過哪個倍數。
* 設定會存在瀏覽器的 localStorage，下次打開還在。

## 公式說明

每一條公式的完整數學定義、推導、手算驗證，以及跟姊妹專案 withdraw-calc 的對照，都在 **[docs/formulas.md](docs/formulas.md)**。這裡是摘要，r、i、g 都是年化小數（8% 寫成 0.08）。

| 項目 | 公式 | 來源 |
| --- | --- | --- |
| 目標金額 | 退休後每月支出 乘以 12 乘以 倍數 | 倍數 = 1 ÷ 起始提領率 |
| 有效報酬 | g = r + (L 減 1) 乘以 (r 減 i) | 自有 1 元加借 (L 減 1) 元，扣掉利息 |
| 逐年資產 | Vn = max(0, Vn減1 乘以 (1 + g)) + 每年再投入 | 複利，年底投入 |
| 年數 | 最小的 n 使 Vn >= 目標，60 年內 | 逐年模擬，與等比級數封閉解交叉檢查 |
| 實質報酬 | (1 + 名目) ÷ (1 + 通膨) 減 1 | 費雪方程式 |
| 幣別 | TWD = EUR 乘以 匯率 | |

| 倍數 | 等同起始提領率 | 出處 |
| --- | --- | --- |
| 15 倍 | 約 6.7% | CLEC 最低門檻 |
| 17 倍 | 約 5.9% | 清流君動態提領（全股票約 6% 起始） |
| 25 倍 | 4% | 4% 法則 |
| 33 倍 | 約 3% | CLEC 保守版 |

### 已知的簡化

* 全部是**名目報酬**，沒有扣通膨。要看今日購買力，請把底層報酬與借款利率都換成實質報酬再填：(1 + 名目) ÷ (1 + 通膨) 減 1。通膨 2% 時 8% 是 5.9%，直接減成 6% 會少算（預設值的 17 倍目標差一年）。
* 有效報酬假設每年再平衡維持固定槓桿，沒有計入波動耗損。頁面上註明了正二長期約只有原型的 1.55 倍。
* 每年再投入是固定金額，不隨薪資或通膨成長。
* 「一次投入」直接加進資產，不另外扣除借款本金；借錢的成本請用槓桿倍數與借款利率表達。
* 目標金額只看生活費，沒有算退休後還在付的借款利息，等於假設退休前已經把槓桿降回 1 倍。
* CLEC 提到的「退休金、勞保可以先從年支出扣掉」沒有獨立欄位，請自行從退休後每月支出扣除。

## 在本機打開

不需要安裝任何東西，也沒有 build 步驟。`index.html` 和 `fire-core.js` 要放在同一個資料夾。

```bash
git clone https://github.com/chouhsuan1202/fire-calc.git
```

```bash
open fire-calc/index.html
```

Windows 用 `start fire-calc\index.html`，Linux 用 `xdg-open fire-calc/index.html`，或直接把檔案拖進瀏覽器。

## 跑測試

單元測試只需要 Node.js 18 以上，沒有其他套件：

```bash
node tests/fire-core.test.js
```

或

```bash
npm test
```

測試直接 `require` 根目錄的 `fire-core.js`，跟網頁載入的是同一個檔案。內容包含：

* docs/formulas.md 裡每一條公式的手算案例。
* 邊界值：0 年、0 報酬、負報酬、有效報酬低於負 100%、輸入上限的極大金額、60 年上限。
* 跟 Python 獨立參考實作比對 500 組案例（`tests/fixtures/reference-cases.json`）。
* 輸入驗證、格式化、localStorage 清理。

畫面層測試用 Playwright 開 Chromium 實際操作頁面（錯誤提示、鍵盤操作、欄位名稱、極端輸入、localStorage 壞掉或無法使用、375px 寬度、重算速度）。沒裝 Playwright 時會自動略過：

```bash
npm i --no-save playwright && npx playwright install chromium
```

```bash
node tests/ui.test.js
```

想重新產生參考案例（需要 Python 3）：

```bash
python3 tests/reference.py
```

`reference.py` 用 `fractions.Fraction` 精確有理數計算，沒有浮點誤差，並用封閉公式再驗一次。

### 自動測試

每次 push 和開 PR，GitHub Actions（`.github/workflows/test.yml`）會自動跑三件事：單元測試、重新產生參考案例並確認跟提交的檔案一致、用 Chromium 跑畫面層測試。結果在 PR 頁面下方的檢查項目，綠色勾勾就是全部通過。

## 檔案結構

```
index.html                         網頁本體（樣式與畫面邏輯）
fire-core.js                       計算核心，全部是純函式，瀏覽器與 Node 共用
docs/formulas.md                   每條公式的數學定義與驗證
tests/fire-core.test.js            單元測試，純 Node
tests/ui.test.js                   畫面層測試，需要 Playwright
tests/reference.py                 Python 獨立參考實作，產生比對案例
tests/fixtures/reference-cases.json
.github/workflows/test.yml         push 與 PR 時自動跑測試
docs/screenshots/                  截圖
```

## 聲明

資料整理自老師們的公開內容，只是把他們的公式放在一起，不是任何人的投資建議。

## License

MIT
