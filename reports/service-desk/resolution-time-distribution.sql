/*
TITLE: Resolution-Time Distribution (Wall-Clock MTTR Buckets)
WHAT IT ANSWERS: How fast do we actually resolve reactive tickets? Wall-clock
  hours from dateoccured (real open) to datecleared (true close), bucketed, with
  counts and average hours per bucket.
KEY COLUMNS: resolve_bucket, bucket_order, tickets, avg_hrs
PARAMS:
  /* EDIT: window start */ '2025-01-01' on datecleared (resolved in window).
  /* EDIT: closed status ids */ (8,9) Resolved/Closed.
RESOLUTION-TIME SOURCE (corrected):
  Wall-clock resolution time = DATEDIFF(minute, dateoccured, datecleared)/60.
  dateoccured is the real OPEN time; datecleared is the real CLOSE time (validated:
  for genuine closed tickets datecleared matches the close action to the minute).
  Flastactiondate was used here previously but is contaminated by post-close
  automations/reopens/appointments, so it is no longer used. datecreated is corrupt
  (row-metadata stamp, negative durations) and cleartime is working-days; neither used.
STUB FILTER (corrected):
  ~90% of "cleared" reactive tickets are instant-closed "Quick Time" stubs where
  datecleared = dateoccured (span 0). These are time-log rows, not real lifecycle
  tickets, and they previously dragged the whole distribution into the fast bucket.
  They are excluded via datecleared > dateoccured so the buckets reflect genuine
  resolution durations.
NOTES:
  - Status IDs 8/9 are the closed set (TstatusType is NOT a reliable open/closed
    flag here - Resolved and Closed both have TstatusType=0).
  - The stub filter (datecleared > dateoccured) also guarantees a positive span.
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
    DATEDIFF(minute, f.dateoccured, f.datecleared)/60.0 AS hrs,
    CASE
      WHEN DATEDIFF(minute, f.dateoccured, f.datecleared)/60.0 <= 1   THEN 0
      WHEN DATEDIFF(minute, f.dateoccured, f.datecleared)/60.0 <= 4   THEN 1
      WHEN DATEDIFF(minute, f.dateoccured, f.datecleared)/60.0 <= 8   THEN 2
      WHEN DATEDIFF(minute, f.dateoccured, f.datecleared)/60.0 <= 24  THEN 3
      WHEN DATEDIFF(minute, f.dateoccured, f.datecleared)/60.0 <= 72  THEN 4
      WHEN DATEDIFF(minute, f.dateoccured, f.datecleared)/60.0 <= 168 THEN 5
      ELSE 6 END AS bk
  FROM FAULTS f
  JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
  WHERE f.fdeleted = f.fmergedintofaultid
    AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
    AND f.status IN (8,9)               /* EDIT: closed status ids */
    AND f.datecleared >= '2025-01-01'   /* EDIT: window start */
    AND f.datecleared > f.dateoccured   /* stub filter: drop instant-closed Quick Time stubs; also guarantees positive span */
) d
GROUP BY d.bk
