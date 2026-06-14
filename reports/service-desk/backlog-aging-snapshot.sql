/*
TITLE: Backlog Aging Snapshot (Open Reactive Tickets by Age Bucket)
WHAT IT ANSWERS: Of tickets open RIGHT NOW, how old are they? Age measured from
  dateoccured (real open time) to today, bucketed so the owner sees how much of
  the backlog is fresh vs rotting.
KEY COLUMNS: age_bucket, tickets, oldest_days, total_logged_hrs
PARAMS: none (uses GETDATE()). Scope = reactive.
NOTES:
  - "Open" = datecleared IS NULL OR datecleared < '1900-01-01' (Halo's open guard).
    This matches status NOT IN (8 Resolved, 9 Closed) in this tenant.
  - Buckets: 0-1d, 2-7d, 8-14d, 15-30d, 31-90d, 90d+.
  - total_logged_hrs = SUM of ACTIONS.timetaken already invested in the bucket.
  - Sort the output in your client by the bucket order column if needed.
*/
SELECT
  CASE b.bk
    WHEN 0 THEN '0-1 days'  WHEN 1 THEN '2-7 days'   WHEN 2 THEN '8-14 days'
    WHEN 3 THEN '15-30 days' WHEN 4 THEN '31-90 days' ELSE '90+ days' END AS age_bucket,
  b.bk AS bucket_order,
  COUNT(*) AS tickets,
  MAX(b.age_days) AS oldest_days,
  CAST(SUM(b.logged_hrs) AS decimal(12,1)) AS total_logged_hrs
FROM (
  SELECT
    f.faultid,
    DATEDIFF(day, f.dateoccured, GETDATE()) AS age_days,
    CASE
      WHEN DATEDIFF(day, f.dateoccured, GETDATE()) <= 1  THEN 0
      WHEN DATEDIFF(day, f.dateoccured, GETDATE()) <= 7  THEN 1
      WHEN DATEDIFF(day, f.dateoccured, GETDATE()) <= 14 THEN 2
      WHEN DATEDIFF(day, f.dateoccured, GETDATE()) <= 30 THEN 3
      WHEN DATEDIFF(day, f.dateoccured, GETDATE()) <= 90 THEN 4
      ELSE 5 END AS bk,
    ISNULL((SELECT SUM(a.timetaken) FROM ACTIONS a WHERE a.faultid = f.faultid), 0) AS logged_hrs
  FROM FAULTS f
  JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
  WHERE f.fdeleted = f.fmergedintofaultid
    AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
    AND (f.datecleared IS NULL OR f.datecleared < '1900-01-01')
) b
GROUP BY b.bk
