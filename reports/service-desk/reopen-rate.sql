/*
TITLE: Reopen Rate (Tickets Bounced Back from Closed)
WHAT IT ANSWERS: How often do "done" tickets come back? Per month (by dateoccured
  cohort), the count of reactive tickets resolved at least once and the count that
  were later REOPENED, with the reopen rate.
KEY COLUMNS: ym, resolved_tickets, reopened_tickets, reopen_rate_pct
DETECTION METHOD (validated):
  A ticket is "reopened" if its ACTIONS history contains a transition OUT of a
  closed status back into an active one:
      ActionStatusBefore IN (8 Resolved, 9 Closed)
      AND ActionStatusAfter NOT IN (8,9) AND ActionStatusAfter > 0
  This caught 155 tickets historically. The simpler faults.fhasbeenclosed=1 AND
  currently-open only finds tickets that are reopened RIGHT NOW (22) and misses
  any that were reopened then re-closed - so the ACTIONS-transition method is used.
  NOTE: TstatusType is NOT a reliable open/closed flag in this tenant (Resolved=8
  and Closed=9 both have TstatusType=0), which is why status IDs 8/9 are hardcoded
  as the closed set.
PARAMS:
  /* EDIT: closed status ids */ (8,9) - the Resolved/Closed status IDs in TSTATUS.
  /* EDIT: window start */ '2025-01-01' on dateoccured.
NOTES:
  - "resolved_tickets" denominator = reactive tickets genuinely closed in the window
    (datecleared > dateoccured); reopened is the subset of those.
  - STUB FILTER: instant-closed "Quick Time" stubs (datecleared = dateoccured) are
    time-log rows, not real lifecycle closes (~90% of the cleared reactive set), so
    they are excluded from the resolved denominator via datecleared > dateoccured
    (this replaces the old bare datecleared >= '1900-01-01' guard, which counted them).
*/
SELECT
  FORMAT(f.dateoccured, 'yyyy-MM') AS ym,
  COUNT(*) AS resolved_tickets,
  SUM(CASE WHEN ro.faultid IS NOT NULL THEN 1 ELSE 0 END) AS reopened_tickets,
  CAST(100.0 * SUM(CASE WHEN ro.faultid IS NOT NULL THEN 1 ELSE 0 END)
       / NULLIF(COUNT(*), 0) AS decimal(5,1)) AS reopen_rate_pct
FROM FAULTS f
JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
LEFT JOIN (
  SELECT DISTINCT a.faultid
  FROM ACTIONS a
  WHERE a.ActionStatusBefore IN (8,9)        /* EDIT: closed status ids */
    AND a.ActionStatusAfter NOT IN (8,9)     /* EDIT: closed status ids */
    AND a.ActionStatusAfter > 0
) ro ON ro.faultid = f.faultid
WHERE f.fdeleted = f.fmergedintofaultid
  AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
  AND f.datecleared > f.dateoccured  /* stub filter: genuinely closed only, drops instant-closed Quick Time stubs */
  AND f.dateoccured >= '2025-01-01'  /* EDIT: window start */
GROUP BY FORMAT(f.dateoccured, 'yyyy-MM')
