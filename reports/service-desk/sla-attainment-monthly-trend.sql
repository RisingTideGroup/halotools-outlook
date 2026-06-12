/*
TITLE: Resolution-SLA Attainment - Monthly Trend
WHAT IT ANSWERS: Is SLA attainment improving or sliding month over month? Per
  calendar month (by dateoccured), the count of SLA-bearing reactive tickets and
  the % that met resolution SLA.
KEY COLUMNS: ym, with_sla, met, breached, pct_met
PARAMS:
  /* EDIT: window start */ '2025-01-01' on dateoccured.
NOTES:
  - Bucketed on dateoccured (real open time) so a month's number reflects the
    cohort raised that month. Slastate finalises once a ticket clears, so the most
    recent month is partial until its open tickets resolve.
  - Slastate: 'I' met, 'O' breached, ''/NULL excluded.
*/
SELECT
  FORMAT(f.dateoccured, 'yyyy-MM') AS ym,
  SUM(CASE WHEN f.Slastate IN ('I','O') THEN 1 ELSE 0 END) AS with_sla,
  SUM(CASE WHEN f.Slastate = 'I' THEN 1 ELSE 0 END) AS met,
  SUM(CASE WHEN f.Slastate = 'O' THEN 1 ELSE 0 END) AS breached,
  CAST(100.0 * SUM(CASE WHEN f.Slastate = 'I' THEN 1 ELSE 0 END)
       / NULLIF(SUM(CASE WHEN f.Slastate IN ('I','O') THEN 1 ELSE 0 END), 0) AS decimal(5,1)) AS pct_met
FROM FAULTS f
JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
WHERE f.fdeleted = f.fmergedintofaultid
  AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
  AND f.dateoccured >= '2025-01-01'  /* EDIT: window start */
GROUP BY FORMAT(f.dateoccured, 'yyyy-MM')
