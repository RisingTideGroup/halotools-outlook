/*
TITLE: Resolution-SLA Attainment by Category
WHAT IT ANSWERS: Which categories breach resolution SLA most? Per category2,
  SLA-bearing reactive ticket count, met/breached, and % met - worst-first.
KEY COLUMNS: category, with_sla, met, breached, pct_met
PARAMS:
  /* EDIT: window start */ '2025-01-01' on dateoccured.
  /* EDIT: min SLA tickets */ HAVING ... >= 5.
NOTES:
  - Slastate: 'I' met, 'O' breached, ''/NULL no SLA (excluded from rate).
  - category2 is the primary category field; blank -> '(uncategorised)'.
  - Because category2 is sparsely filled on reactive tickets here, most SLA-bearing
    rows will land in '(uncategorised)' - that itself is the finding.
*/
SELECT TOP 50
  CASE WHEN LTRIM(RTRIM(ISNULL(f.category2,''))) = '' THEN '(uncategorised)' ELSE f.category2 END AS category,
  SUM(CASE WHEN f.Slastate IN ('I','O') THEN 1 ELSE 0 END) AS with_sla,
  SUM(CASE WHEN f.Slastate = 'I' THEN 1 ELSE 0 END) AS met,
  SUM(CASE WHEN f.Slastate = 'O' THEN 1 ELSE 0 END) AS breached,
  CAST(100.0 * SUM(CASE WHEN f.Slastate = 'I' THEN 1 ELSE 0 END)
       / NULLIF(SUM(CASE WHEN f.Slastate IN ('I','O') THEN 1 ELSE 0 END),0) AS decimal(5,1)) AS pct_met
FROM FAULTS f
JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
WHERE f.fdeleted = f.fmergedintofaultid
  AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
  AND f.dateoccured >= '2025-01-01'  /* EDIT: window start */
GROUP BY CASE WHEN LTRIM(RTRIM(ISNULL(f.category2,''))) = '' THEN '(uncategorised)' ELSE f.category2 END
HAVING SUM(CASE WHEN f.Slastate IN ('I','O') THEN 1 ELSE 0 END) >= 5  /* EDIT: min SLA tickets */
ORDER BY pct_met ASC
