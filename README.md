# FIRE 計算器（槓桿老師版）

**Live demo: https://chouhsuan1202.github.io/fire-calc/**

How much do you need to retire, and how many years will it take? This calculator puts the rules from six Chinese-language finance teachers side by side. Fill in six numbers and see every answer at once.

[![screenshot](docs/screenshot.png)](https://chouhsuan1202.github.io/fire-calc/)

## What it does

- Six numbers in: assets today, monthly spending now, monthly spending after retirement, yearly contribution, expected return, currency.
- Four targets out: 15x, 17x, 25x and 33x of yearly spending. Each shows the amount and the years to get there.
- EUR and TWD side by side, with an editable exchange rate.
- A sensitivity table: what changes the years the most, and how return rates shift the result.
- A year by year asset chart.
- Advanced: leverage and a one time lump sum.

## Why

Chinese-speaking investors follow several popular teachers who each use a different withdrawal rule. Comparing them by hand is slow. This tool does it in one screen, using their public formulas as they describe them. It is not investment advice.

## Tech

One HTML file. No build step, no backend, no tracking, no dependencies. Open `index.html` in a browser or visit the demo above.

## Run locally

```bash
git clone https://github.com/chouhsuan1202/fire-calc.git
open fire-calc/index.html
```

## 中文說明

填六個數字，看六位槓桿老師的 FIRE 算法各自要存多少、幾年到。歐元台幣都能算。單一 HTML 檔，不用安裝，打開就能用。這是名目報酬，沒扣通膨，資料整理自老師們的公開內容，不是投資建議。

## License

MIT
