/*
TITLE:        Business-Hours vs After-Hours Work Pattern
WHAT IT ANSWERS:
              Per technician, what share of their time-bearing actions fall
              OUTSIDE standard business hours (weekends, or before 08:00 / after
              18:00). A work-pattern diagnostic, not a performance verdict.
KEY COLUMNS:  tech, time_entries, business_hours, after_hours, after_hours_pct
PARAMS:       @from / @to on ActionDateCreated (EDIT below). Business-hours
              bounds are EDITable (the hour < 8 / hour >= 18 and weekday IN(1,7)).
NOTES:
 - Counts time-bearing actions only (timetaken > 0) so automated/system events
   don't dominate.
 - IMPORTANT timezone caveat: ActionDateCreated is stored in the server's clock
   (effectively UTC here), NOT each tech's local time. So a high after_hours_pct
   can simply mean the tech works in a timezone offset from the server, or this
   team genuinely works evenings. Adjust the hour bounds, or wrap
   ActionDateCreated in a DATEADD offset, to match the team's real day before
   drawing conclusions. Treat this as "when does work land on the clock", a
   pattern flag for conversation -- never as proof of over- or under-work.
 - DATEPART(weekday, ...) is 1=Sunday .. 7=Saturday under the default US
   DATEFIRST; if your server's DATEFIRST differs, adjust the IN (1,7) set.
 - Bot agents excluded.
*/
SELECT TOP 1000
    u.uname                                                            AS tech,
    COUNT(*)                                                           AS time_entries,
    SUM(CASE WHEN DATEPART(weekday, a.ActionDateCreated) NOT IN (1,7)
              AND DATEPART(hour, a.ActionDateCreated) >= 8
              AND DATEPART(hour, a.ActionDateCreated) < 18
             THEN 1 ELSE 0 END)                                        AS business_hours,
    SUM(CASE WHEN DATEPART(weekday, a.ActionDateCreated) IN (1,7)
               OR DATEPART(hour, a.ActionDateCreated) < 8
               OR DATEPART(hour, a.ActionDateCreated) >= 18
             THEN 1 ELSE 0 END)                                        AS after_hours,
    CAST(100.0 * SUM(CASE WHEN DATEPART(weekday, a.ActionDateCreated) IN (1,7)
                            OR DATEPART(hour, a.ActionDateCreated) < 8
                            OR DATEPART(hour, a.ActionDateCreated) >= 18
                          THEN 1 ELSE 0 END)
         / COUNT(*) AS decimal(5,1))                                   AS after_hours_pct
FROM ACTIONS a
JOIN UNAME u ON u.Unum = a.whoagentid
WHERE a.ActionDateCreated >= '2026-05-01'   /* EDIT: window start (inclusive) */
  AND a.ActionDateCreated <  '2026-06-01'   /* EDIT: window end   (exclusive) */
  AND a.timetaken > 0
  AND COALESCE(u.uisapiagent,0) = 0
GROUP BY u.uname
ORDER BY after_hours_pct DESC
