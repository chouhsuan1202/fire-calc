"""
獨立參考實作（Python），用來交叉驗證 index.html 裡 FireCore 的計算。

- 全部用 fractions.Fraction 做精確有理數運算，沒有浮點誤差。
- 年數另外用封閉公式（等比級數）再算一次，兩種算法要一致。
- 執行後會輸出 tests/fixtures/reference-cases.json，給 fire-core.test.js 比對。

用法：python3 tests/reference.py
"""
from fractions import Fraction as F
import json
import math
import os
import random

YEAR_CAP = 60


def effective_return(r, lev, i):
    """有效報酬 = L 乘以 r 減 (L - 1) 乘以 i，跟 r + (L-1)(r-i) 代數上相等"""
    return lev * r - (lev - 1) * i


def years_iter(v0, annual, g, target, cap=YEAR_CAP):
    """逐年模擬：先滾一年報酬（最低到 0），年底再投入"""
    if v0 >= target:
        return 0
    v = v0
    for n in range(1, cap + 1):
        v = max(F(0), v * (1 + g)) + annual
        if v >= target:
            return n
    return None


def years_closed(v0, annual, g, target, cap=YEAR_CAP):
    """
    封閉公式：V_n = V0 (1+g)^n + a ((1+g)^n - 1) / g，g = 0 時 V_n = V0 + n a。
    只用在 g >= 0（資產單調遞增）的情況。
    """
    v0, a, t, g = float(v0), float(annual), float(target), float(g)
    if v0 >= t:
        return 0
    if g == 0:
        if a <= 0:
            return None
        n = math.ceil((t - v0) / a - 1e-12)
    else:
        k = a / g
        if v0 + k <= 0:
            return None
        n = math.ceil(math.log((t + k) / (v0 + k)) / math.log(1 + g) - 1e-12)
    n = max(n, 1)
    return n if n <= cap else None


def pct(x):
    """把「8」這種百分比字串轉成精確小數 0.08"""
    return F(str(x)) / 100


def build_cases():
    rnd = random.Random(20261102)
    cases = []

    # 一、手挑的代表案例與邊界
    hand = [
        # (說明, 資產, 一次投入, 每年投入, 退休月支出, 倍數, 底層%, 槓桿, 借款%)
        ("預設值 25 倍", 200000, 0, 10000, 4000, 25, 8, 1.0, 4),
        ("預設值 17 倍", 200000, 0, 10000, 4000, 17, 8, 1.0, 4),
        ("預設值 15 倍", 200000, 0, 10000, 4000, 15, 8, 1.0, 4),
        ("預設值 33 倍", 200000, 0, 10000, 4000, 33, 8, 1.0, 4),
        ("報酬 0%、只靠存錢", 0, 0, 12000, 1000, 25, 0, 1.0, 0),
        ("報酬 0%、剛好整除", 100000, 0, 50000, 2500, 25, 0, 1.0, 0),
        ("已經達標", 2000000, 0, 0, 4000, 25, 8, 1.0, 4),
        ("剛好等於目標", 1200000, 0, 0, 4000, 25, 8, 1.0, 4),
        ("資產 0、不投入、永遠到不了", 0, 0, 0, 4000, 25, 8, 1.0, 4),
        ("負報酬", 500000, 0, 30000, 2000, 25, -2, 1.0, 4),
        ("負報酬、到不了", 500000, 0, 10000, 4000, 25, -5, 1.0, 4),
        ("槓桿 1.5", 200000, 0, 10000, 4000, 25, 8, 1.5, 4),
        ("槓桿 2、借款利率高於報酬", 200000, 0, 10000, 4000, 25, 3, 2.0, 6),
        ("一次投入", 200000, 100000, 10000, 4000, 25, 8, 1.0, 4),
        ("高報酬 50%", 10000, 0, 1000, 4000, 25, 50, 1.0, 4),
        ("極端槓桿虧損低於 -100%", 200000, 0, 10000, 4000, 25, -50, 2.0, 30),
        ("極端槓桿虧損、投入夠大", 200000, 0, 1300000, 4000, 25, -50, 2.0, 30),
        ("大金額", 10**12, 0, 10**9, 10**8, 33, 7, 1.0, 4),
        ("剛好第 60 年", 0, 0, 20000, 4000, 25, 0, 1.0, 0),
        ("差一點超過 60 年", 0, 0, 19999, 4000, 25, 0, 1.0, 0),
    ]
    for (name, asset, lump, annual, exp, mult, r, lev, i) in hand:
        cases.append(dict(name=name, asset=asset, lump=lump, annual=annual, retireExpense=exp,
                          mult=mult, baseReturn=r, leverage=lev, loanRate=i))

    # 二、隨機案例
    for k in range(400):
        cases.append(dict(
            name="random-%d" % k,
            asset=rnd.choice([0, 50000, 200000, rnd.randint(0, 3000000)]),
            lump=rnd.choice([0, 0, 0, rnd.randint(0, 500000)]),
            annual=rnd.choice([0, 6000, 10000, rnd.randint(0, 100000)]),
            retireExpense=rnd.choice([1500, 3000, 4000, rnd.randint(1, 20000)]),
            mult=rnd.choice([15, 17, 25, 33]),
            baseReturn=rnd.choice([0, 4, 6, 8, 10, 12, rnd.randint(-100, 300) / 10]),
            leverage=rnd.choice([1.0, 1.0, 1.2, 1.5, 2.0, rnd.randint(10, 20) / 10]),
            loanRate=rnd.choice([0, 2, 4, 6, rnd.randint(0, 150) / 10]),
        ))

    # 三、刻意讓第 n 年的資產「剛好等於」目標，測浮點邊界
    for k in range(80):
        r = rnd.choice([5, 6, 7, 8, 10])
        v0 = rnd.randint(1, 50) * 10000
        annual = rnd.randint(0, 20) * 1000
        n = rnd.randint(1, 30)
        v = F(v0)
        for _ in range(n):
            v = v * (1 + pct(r)) + annual
        # 退休月支出 = 目標 / (12 乘以 25)，讓 25 倍目標剛好等於第 n 年資產
        exp = v / (12 * 25)
        cases.append(dict(name="exact-hit-%d" % k, asset=v0, lump=0, annual=annual,
                          retireExpense=float(exp), retireExpenseExact=[exp.numerator, exp.denominator],
                          mult=25, baseReturn=r, leverage=1.0, loanRate=0))

    for c in cases:
        if "retireExpenseExact" in c:
            exp = F(*c["retireExpenseExact"])
        else:
            exp = F(str(c["retireExpense"]))
        target = exp * 12 * c["mult"]
        g = effective_return(pct(c["baseReturn"]), F(str(c["leverage"])), pct(c["loanRate"]))
        v0 = F(c["asset"]) + F(c["lump"])
        y = years_iter(v0, F(c["annual"]), g, target)
        if g >= 0:
            assert y == years_closed(v0, F(c["annual"]), g, target), c["name"]
        c["effectiveReturn"] = float(g)
        c["target"] = float(target)
        c["expectedYears"] = y
    return cases


if __name__ == "__main__":
    cases = build_cases()
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "reference-cases.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(cases, f, ensure_ascii=False, indent=1)
    print("寫出 %d 個案例到 %s" % (len(cases), out))
