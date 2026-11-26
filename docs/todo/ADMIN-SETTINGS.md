# Admin → Настройки: pending fixes (operator, 2026-11-26 — «оставь на потом, там много чего нужно сделать»)

Screenshot of the screen as it was (phone width, dev data): [admin-settings-2026-11-26.jpg](admin-settings-2026-11-26.jpg)

Agreed so far (not started — the operator will go through this screen later and add more):
1. Fields one per row on a phone. Now three columns: labels break into 4–6 lines, the selects are cut
   («Час вы…», «60 ми…»).
2. Labels in normal letters instead of CAPITALS; write «ПП» out in full («Попутчик»).
3. Remove the outdated «Зона обслуживания — изменить через API» block (zones are drawn in their own admin
   sections now).
4. Operator's own data instead of the examples: name «Иван Иванов (самозанятый)», address «Пример: ул. Макариу 1…»,
   +357 99 000000, support@example.com. This is data the operator enters in this screen, not code — it shows in
   Поддержка, Политика, Условия and the driver's «Помощь».

Done already: the «Включить уведомления о поездке» strip is gone from admin phone pages; the switch is in
«Безопасность» (deployed 2026-11-26).
