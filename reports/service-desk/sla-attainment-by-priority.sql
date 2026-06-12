/*
TITLE: Resolution-SLA Attainment by Priority
WHAT IT ANSWERS: For reactive tickets that carry a resolution SLA, what % met it,
  broken down by priority (seriousness). Shows where the SLA pain concentrates.
KEY COLUMNS: priority, with_sla, met, breached, pct_met
PARAMS:
  /* EDIT: window start */ '2025-01-01' on dateoccured.
NOTES:
  - Slastate is the RESOLUTION SLA state: 'I' = met (in SLA), 'O' = breached
    (out of SLA), '' / NULL = no SLA configured (excluded from the rate).
  - Priority lives in faults.seriousness (raw int). Lower usually = higher urgency;
    label mapping left raw so it stays MSP-agnostic.
  - pct_met is over (met + breached), i.e. only SLA-bearing tickets.
*/
SELECT
  f.seriousness AS priority,
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
GROUP BY f.seriousness
