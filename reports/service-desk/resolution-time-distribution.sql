/*
TITLE: Resolution-Time Distribution (Wall-Clock MTTR Buckets)
WHAT IT ANSWERS: How fast do we actually resolve reactive tickets? Wall-clock
  hours from dateoccured (real open) to the LAST action on the ticket
  (Flastactiondate, the effective resolution time), bucketed, with counts and
  average hours per bucket.
KEY COLUMNS: resolve_bucket, bucket_order, tickets, avg_hrs
PARAMS:
  /* EDIT: window start */ '2025-01-01' on datecleared (resolved in window).
  /* EDIT: closed status ids */ (8,9) Resolved/Closed.
CRITICAL DATA-QUALITY NOTE (this tenant):
  faults.datecleared is NOT a usable resolution TIMESTAMP - ~96% of resolved
  tickets have datecleared == dateoccured (span 0). It IS reliable as a flag for
  "this ticket is resolved and in which window", so it is used ONLY to scope the
  cohort. The actual resolution time is taken from Flastactiondate (last action
  date), which has a sensible positive span on ~97% of resolved tickets.
  datecreated is corrupt; cleartime is working-days; neither is used.
NOTES:
  - Status IDs 8/9 are the closed set (TstatusType is NOT a reliable open/closed
    flag here - Resolved and Closed both have TstatusType=0).
  - Negative/zero spans (rare data quirks) are excluded (> 0).
*/
SELECT
  CASE d.bk
    WHEN 0 THEN '<= 1 hour'   WHEN 1 THEN '1-4 hours'  WHEN 2 THEN '4-8 hours'
    WHEN 3 THEN '8-24 hours'  WHEN 4 THEN '1-3 days'   WHEN 5 THEN '3-7 days'
    ELSE '> 7 days' END AS resolve_bucket,
  d.bk AS bucket_order,
  COUNT(*) AS tickets,
  CAST(AVG(d.hrs) AS decimal(10,1)) AS avg_hrs
FROM (
  SELECT
    DATEDIFF(minute, f.dateoccured, f.Flastactiondate)/60.0 AS hrs,
    CASE
      WHEN DATEDIFF(minute, f.dateoccured, f.Flastactiondate)/60.0 <= 1   THEN 0
      WHEN DATEDIFF(minute, f.dateoccured, f.Flastactiondate)/60.0 <= 4   THEN 1
      WHEN DATEDIFF(minute, f.dateoccured, f.Flastactiondate)/60.0 <= 8   THEN 2
      WHEN DATEDIFF(minute, f.dateoccured, f.Flastactiondate)/60.0 <= 24  THEN 3
      WHEN DATEDIFF(minute, f.dateoccured, f.Flastactiondate)/60.0 <= 72  THEN 4
      WHEN DATEDIFF(minute, f.dateoccured, f.Flastactiondate)/60.0 <= 168 THEN 5
      ELSE 6 END AS bk
  FROM FAULTS f
  JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
  WHERE f.fdeleted = f.fmergedintofaultid
    AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
    AND f.status IN (8,9)               /* EDIT: closed status ids */
    AND f.datecleared >= '2025-01-01'   /* EDIT: window start - cohort flag only */
    AND f.Flastactiondate >= '1900-01-01'
    AND DATEDIFF(minute, f.dateoccured, f.Flastactiondate) > 0
) d
GROUP BY d.bk
