/*
TITLE:        Technician Monthly Throughput Trend
WHAT IT ANSWERS:
              Per technician per calendar month: tickets resolved, hours logged,
              and distinct tickets touched. The time series behind "is this tech
              trending down?" -- read across months for a given tech.
KEY COLUMNS:  tech, ym (YYYY-MM), resolved, hrs_logged, tickets_touched
PARAMS:       @from / @to window  -- EDIT below (set wide enough to see a trend).
NOTES:
 - One row per tech per month bucket (CONVERT(char(7), datecleared, 126) = the
   ISO year-month of the CLOSE date). resolved is bucketed by when the ticket was
   closed; tickets_touched / hrs_logged are bucketed by action date in the same
   month (via the OUTER APPLY restricted to that month window).
 - A clean declining "resolved" line month over month, alongside flat/declining
   hrs_logged, is the throughput-decline signal. Compare techs against their own
   prior months, not just against each other.
 - hrs_logged sums only this tech's own actions on the ticket (whoagentid match),
   so shared tickets don't double-count the closer's hours.
 - Excludes bot agents and deleted/merged tickets. datecleared > sentinel ensures
   only genuinely closed tickets count.
*/
SELECT TOP 1000
    u.uname                                                AS tech,
    CONVERT(char(7), f.datecleared, 126)                   AS ym,
    COUNT(*)                                               AS resolved,
    CAST(SUM(ISNULL(t.hrs,0)) AS decimal(12,1))            AS hrs_logged,
    COUNT(DISTINCT f.Faultid)                              AS tickets_touched
FROM FAULTS f
JOIN UNAME u ON u.Unum = f.Clearwhoint
OUTER APPLY (
    SELECT SUM(a.timetaken) AS hrs
    FROM ACTIONS a
    WHERE a.Faultid = f.Faultid
      AND a.whoagentid = u.Unum
) t
WHERE f.datecleared >= '2026-01-01'   /* EDIT: window start (inclusive) */
  AND f.datecleared <  '2026-06-01'   /* EDIT: window end   (exclusive) */
  AND f.datecleared > '1900-01-01'
  AND COALESCE(f.FDeleted,0) = 0
  AND COALESCE(f.FMergedIntoFaultid,0) = 0
  AND COALESCE(u.uisapiagent,0) = 0
GROUP BY u.uname, CONVERT(char(7), f.datecleared, 126)
ORDER BY u.uname, CONVERT(char(7), f.datecleared, 126)
