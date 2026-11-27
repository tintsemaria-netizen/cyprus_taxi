# Car meter vs GPS meter — data log (collecting; compare later)

Operator 2026-11-27: «пока данные собираем, когда соберём — будем сверять». Do not change
OWN_METER_MARKUP_PCT (src/lib/tariff.ts, now +5 %) until there are enough rides. For each ride, record the car's meter
sum and, if the meter shows it, the car meter's km.

| Date | Car | Tariff | Car meter | Car meter km | GPS meter | GPS km | Wait | No GPS | Charged | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-19 | ? | night | 85.23 € | ? | — | 68.4 | ? | ? | ? | Limassol → LCA (before +5 %) |
| 2026-11-26 | ? | day | 72.50 € | ? | 68.65 € | ? | ? | ? | ? | Limassol → LCA (before +5 %) |
| 2026-11-27 | Mercedes W212 | 1 (day) | 79.37 € | ? | 84.76 € (+5 %) | 78.7 | 8:25 | 17:00 | 78.80 € | 245/40 R18 front, 265/35 R18 rear |
| 2026-11-27 | Mercedes (same driver phone) | 1 (day) | ≈73.1x € (photo blurry; 7.31 € at 3.0 km) | ? | 72.80 € (+5 %) | 67.5 | 7:25 | 0:35 | 72.82 € | Limassol → LCA, 16:44–17:31; GPS meter 7.32 € at 3.0 km |

Notes for the comparison:
- 2026-11-27: without the +5 % the GPS meter is ≈ 80.7 € (+1.7 % vs the car). Likely the 17 min gap (straight line × 1.2).
- Tyres: circumference ≈ 2052 mm front / 2019 mm rear (1.6 % apart); tread wear new → 3 mm ≈ +1.5 % km on the car meter.
- Exclude or weight down the rides with long GPS gaps (see docs/todo/DRIVER-GPS-LOSS.md).
