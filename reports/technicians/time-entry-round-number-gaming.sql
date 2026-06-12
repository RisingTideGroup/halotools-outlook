/*
TITLE:        Time-Entry Round-Number Share (gaming / guesstimate detector)
WHAT IT ANSWERS:
              Per technician, what proportion of their time entries land on
              suspiciously round values (0.25 / 0.5 / 0.75 / 1.0 / 1.5 / 2.0 hr).
              A high share suggests estimated/guessed time rather than tracked
              time -- not proof of gaming, but a coaching/audit prompt.
KEY COLUMNS:  tech, time_entries, round_entries, round_pct, avg_entry_hrs
PARAMS:       @from / @to on ActionDateCreated  -- EDIT below. Edit the IN(...)
              set of "round" values if your team books to different increments.
NOTES:
 - One row per time-bearing ACTION (timetaken > 0). System/automation actions
   carry no time so they fall out naturally; bot agents are also excluded.
 - "Round" set deliberately excludes very small values (e.g. 0.1) that are the
   product of real elapsed-time tracking. Tune to taste.
 - Interpret relative to peers, not as an absolute threshold: a tech far above
   the team's round_pct is the signal.
 - avg_entry_hrs is a sanity companion (very large round entries differ from a
   pile of tidy 0.5s).
*/
SELECT TOP 1000
    u.uname                                                            AS tech,
    COUNT(*)                                                           AS time_entries,
    SUM(CASE WHEN a.timetaken IN (0.25,0.5,0.75,1.0,1.5,2.0) THEN 1 ELSE 0 END)  AS round_entries,
    CAST(100.0 * SUM(CASE WHEN a.timetaken IN (0.25,0.5,0.75,1.0,1.5,2.0) THEN 1 ELSE 0 END)
         / COUNT(*) AS decimal(5,1))                                   AS round_pct,
    CAST(AVG(a.timetaken) AS decimal(10,3))                            AS avg_entry_hrs
FROM ACTIONS a
JOIN UNAME u ON u.Unum = a.whoagentid
WHERE a.ActionDateCreated >= '2026-03-01'   /* EDIT: window start (inclusive) */
  AND a.ActionDateCreated <  '2026-06-01'   /* EDIT: window end   (exclusive) */
  AND a.timetaken > 0
  AND COALESCE(u.uisapiagent,0) = 0
GROUP BY u.uname
ORDER BY round_pct DESC
