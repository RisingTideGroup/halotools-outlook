/*
TITLE: Stale Open Tickets (No Activity in 7 / 14 / 30 Days)
WHAT IT ANSWERS: Which open reactive tickets have gone quiet? Lists every open
  ticket whose last action (Flastactiondate) is older than 7 days, flagged into
  7/14/30-day staleness tiers, so the owner can chase the rot at the top.
KEY COLUMNS: faultid, client, agent, status, age_days, days_since_action,
  stale_tier, logged_hrs
PARAMS:
  /* EDIT: only show tickets stale beyond N days */ change the final >= 7 threshold.
NOTES:
  - Flastactiondate is Halo's stamp of the most recent action on the ticket.
    Where it is empty (NULL/epoch) we fall back to dateoccured so brand-new,
    action-less tickets still age correctly.
  - "Open" = datecleared NULL/epoch.
  - TOP + ORDER BY required by Report Center; raise TOP for full extract.
*/
SELECT TOP 500
  f.faultid,
  ar.aareadesc AS client,
  ua.uname     AS agent,
  ts.tstatusdesc AS status,
  DATEDIFF(day, f.dateoccured, GETDATE()) AS age_days,
  DATEDIFF(day, CASE WHEN f.Flastactiondate >= '1900-01-01' THEN f.Flastactiondate ELSE f.dateoccured END, GETDATE()) AS days_since_action,
  CASE
    WHEN DATEDIFF(day, CASE WHEN f.Flastactiondate >= '1900-01-01' THEN f.Flastactiondate ELSE f.dateoccured END, GETDATE()) >= 30 THEN '30+ days'
    WHEN DATEDIFF(day, CASE WHEN f.Flastactiondate >= '1900-01-01' THEN f.Flastactiondate ELSE f.dateoccured END, GETDATE()) >= 14 THEN '14-29 days'
    ELSE '7-13 days' END AS stale_tier,
  CAST(ISNULL((SELECT SUM(a.timetaken) FROM ACTIONS a WHERE a.faultid = f.faultid), 0) AS decimal(12,1)) AS logged_hrs
FROM FAULTS f
JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
LEFT JOIN AREA ar  ON ar.aarea = f.areaint
LEFT JOIN UNAME ua ON ua.unum  = f.assignedtoint
LEFT JOIN TSTATUS ts ON ts.Tstatus = f.status
WHERE f.fdeleted = f.fmergedintofaultid
  AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
  AND (f.datecleared IS NULL OR f.datecleared < '1900-01-01')
  AND DATEDIFF(day, CASE WHEN f.Flastactiondate >= '1900-01-01' THEN f.Flastactiondate ELSE f.dateoccured END, GETDATE()) >= 7  /* EDIT: staleness threshold days */
ORDER BY days_since_action DESC
