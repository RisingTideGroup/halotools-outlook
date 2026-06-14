/*
TITLE: First-Response Time Distribution + SLA Breach List
WHAT IT ANSWERS: How quickly do we first respond, and which tickets blew the
  first-response SLA? Two things in one family:
   (A) wall-clock first-response distribution from dateoccured -> ffirstresponsedate;
   (B) the breach list (Fslafirstresponsestate='O') with the offending tickets.
  This file is the DISTRIBUTION (A). For the breach list run the variant in NOTES.
KEY COLUMNS: fr_bucket, bucket_order, tickets, avg_minutes
PARAMS:
  /* EDIT: window start */ '2025-01-01' on dateoccured.
NOTES:
  - ffirstresponsedate is populated broadly (~82% of recent reactive tickets) even
    though the first-response SLA (Fslafirstresponsestate) is sparsely configured
    here - so the DISTRIBUTION uses the date field for coverage, while SLA
    attainment should be read with the caveat that most tickets have no FR-SLA.
  - DATA-QUALITY CAVEAT: on a large share of tickets ffirstresponsedate is stamped
    equal to dateoccured (auto-acknowledgement / intake automation), so the "<=15
    min" bucket is inflated and its avg_minutes ~ 0. Read the SLOWER buckets as the
    meaningful human-response signal; treat the fastest bucket as "auto-acked".
  - BREACH LIST variant (swap in when you want the offenders):
      SELECT TOP 200 f.faultid, ar.aareadesc AS client, ua.uname AS agent,
        f.dateoccured, f.ffirstresponsedate, f.Ffirstrespondbydate
      FROM FAULTS f JOIN REQUESTTYPE rt ON rt.RTid=f.requesttypenew
      LEFT JOIN AREA ar ON ar.aarea=f.areaint
      LEFT JOIN UNAME ua ON ua.unum=f.assignedtoint
      WHERE f.fdeleted=f.fmergedintofaultid AND rt.RTIsProject=0 AND rt.RTIsOpportunity=0
        AND f.Fslafirstresponsestate='O'
      ORDER BY f.dateoccured DESC
*/
SELECT
  CASE d.bk
    WHEN 0 THEN '<= 15 min'  WHEN 1 THEN '15-60 min' WHEN 2 THEN '1-4 hours'
    WHEN 3 THEN '4-8 hours'  WHEN 4 THEN '8-24 hours' ELSE '> 24 hours' END AS fr_bucket,
  d.bk AS bucket_order,
  COUNT(*) AS tickets,
  CAST(AVG(d.mins) AS decimal(12,1)) AS avg_minutes
FROM (
  SELECT
    DATEDIFF(minute, f.dateoccured, f.ffirstresponsedate) AS mins,
    CASE
      WHEN DATEDIFF(minute, f.dateoccured, f.ffirstresponsedate) <= 15   THEN 0
      WHEN DATEDIFF(minute, f.dateoccured, f.ffirstresponsedate) <= 60   THEN 1
      WHEN DATEDIFF(minute, f.dateoccured, f.ffirstresponsedate) <= 240  THEN 2
      WHEN DATEDIFF(minute, f.dateoccured, f.ffirstresponsedate) <= 480  THEN 3
      WHEN DATEDIFF(minute, f.dateoccured, f.ffirstresponsedate) <= 1440 THEN 4
      ELSE 5 END AS bk
  FROM FAULTS f
  JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
  WHERE f.fdeleted = f.fmergedintofaultid
    AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
    AND f.ffirstresponsedate >= '1900-01-01'
    AND f.dateoccured >= '2025-01-01'  /* EDIT: window start */
    AND DATEDIFF(minute, f.dateoccured, f.ffirstresponsedate) >= 0
) d
GROUP BY d.bk
