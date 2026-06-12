/*
TITLE:        Technician Productivity Scorecard (per month)
WHAT IT ANSWERS:
              For each technician in a window: how many tickets they resolved,
              how many actions they logged, total time logged, billable vs
              non-billable hours and ratio, and how many distinct tickets they
              touched. The core "what did each tech do" rollup.
KEY COLUMNS:  tech, resolved, actions_logged, tickets_touched, hrs_logged,
              billable_hrs, nonbillable_hrs, billable_ratio_pct
PARAMS:       @from / @to date window  -- EDIT the two date literals below.
NOTES:
 - Tech = UNAME (uname.unum = whoagentid on the action; clearwhoint on the fault).
 - "resolved" counts tickets this tech closed (Clearwhoint) in the window,
   identified by datecleared being set (> '1900-01-01').
 - Bot/automation agents are excluded via COALESCE(uisapiagent,0)=0. IMPORTANT:
   in this schema uisapiagent is NULL/empty for real techs and only True for
   bots, so a plain "= 0" test wrongly excludes everyone -- always COALESCE.
 - timetaken = hours logged on the action. Billable hours =
   ActionChargeHours + ActionPrePayHours; non-billable = ActionNonChargeHours.
 - actions_logged includes system/automation outcomes attributed to the tech;
   for "human work only" you can add a filter on Actoutcome, but counts here are
   already bot-free.
*/
SELECT TOP 1000
    u.uname                                                          AS tech,
    COUNT(DISTINCT CASE WHEN f.Clearwhoint = u.Unum
                         AND f.datecleared IS NOT NULL
                         AND f.datecleared > '1900-01-01'
                        THEN f.Faultid END)                          AS resolved,
    COUNT(*)                                                         AS actions_logged,
    COUNT(DISTINCT a.Faultid)                                        AS tickets_touched,
    CAST(SUM(ISNULL(a.timetaken,0)) AS decimal(12,2))               AS hrs_logged,
    CAST(SUM(ISNULL(a.ActionChargeHours,0) + ISNULL(a.ActionPrePayHours,0)) AS decimal(12,2)) AS billable_hrs,
    CAST(SUM(ISNULL(a.ActionNonChargeHours,0)) AS decimal(12,2))     AS nonbillable_hrs,
    CAST(100.0 * SUM(ISNULL(a.ActionChargeHours,0) + ISNULL(a.ActionPrePayHours,0))
         / NULLIF(SUM(ISNULL(a.timetaken,0)),0) AS decimal(5,1))    AS billable_ratio_pct
FROM ACTIONS a
JOIN UNAME u  ON u.Unum = a.whoagentid
LEFT JOIN FAULTS f
       ON f.Faultid = a.Faultid
      AND COALESCE(f.FDeleted,0) = 0
      AND COALESCE(f.FMergedIntoFaultid,0) = 0
WHERE a.ActionDateCreated >= '2026-05-01'   /* EDIT: window start (inclusive) */
  AND a.ActionDateCreated <  '2026-06-01'   /* EDIT: window end   (exclusive) */
  AND COALESCE(u.uisapiagent,0) = 0
GROUP BY u.uname
ORDER BY SUM(ISNULL(a.timetaken,0)) DESC
