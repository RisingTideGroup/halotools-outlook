/*
TITLE: Resolution-SLA Attainment by Client
WHAT IT ANSWERS: Which clients are we breaching resolution SLA on? Per-client
  met/breached counts and % met, ordered worst-first, for the accounts most at
  risk of a QBR complaint.
KEY COLUMNS: client, with_sla, met, breached, pct_met
PARAMS:
  /* EDIT: window start */ '2025-01-01' on dateoccured.
  /* EDIT: min SLA tickets */ HAVING ... >= 5 hides tiny-sample clients.
NOTES:
  - Slastate: 'I' met, 'O' breached, ''/NULL no SLA (excluded from rate).
  - Client = AREA (area.aareadesc), joined area.aarea = faults.areaint.
  - Ordered by pct_met ascending so the worst attainment is at the top.
  - STUB FILTER: instant-closed "Quick Time" stubs (datecleared = dateoccured) are
    time-log rows, not real lifecycle tickets, so they are excluded from this
    SLA-attainment count. Keeps real closed + all open tickets.
*/
SELECT TOP 100
  ar.aareadesc AS client,
  SUM(CASE WHEN f.Slastate IN ('I','O') THEN 1 ELSE 0 END) AS with_sla,
  SUM(CASE WHEN f.Slastate = 'I' THEN 1 ELSE 0 END) AS met,
  SUM(CASE WHEN f.Slastate = 'O' THEN 1 ELSE 0 END) AS breached,
  CAST(100.0 * SUM(CASE WHEN f.Slastate = 'I' THEN 1 ELSE 0 END)
       / NULLIF(SUM(CASE WHEN f.Slastate IN ('I','O') THEN 1 ELSE 0 END), 0) AS decimal(5,1)) AS pct_met
FROM FAULTS f
JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
JOIN AREA ar ON ar.aarea = f.areaint
WHERE f.fdeleted = f.fmergedintofaultid
  AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
  AND f.dateoccured >= '2025-01-01'  /* EDIT: window start */
  AND (f.datecleared > f.dateoccured OR f.datecleared IS NULL OR f.datecleared < '1900-01-01')  /* stub filter: drop instant-closed Quick Time stubs */
GROUP BY ar.aareadesc
HAVING SUM(CASE WHEN f.Slastate IN ('I','O') THEN 1 ELSE 0 END) >= 5  /* EDIT: min SLA tickets */
ORDER BY pct_met ASC
