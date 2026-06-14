/*
TITLE:        Per-Tech x Category Quality Hotspots (SLA breach + reopens)
WHAT IT ANSWERS:
              For each technician x category, the resolution-SLA breach rate and
              reopen count on the tickets they closed. Pinpoints WHICH categories
              a given tech struggles with -- the targeted coaching companion to
              the team-wide quality scorecard.
KEY COLUMNS:  cat, tech, resolved, with_sla, sla_breach_pct, reopened
PARAMS:       @from / @to on datecleared (EDIT below). Minimum SLA'd tickets per
              cell (EDIT the HAVING threshold) to keep cells statistically real.
NOTES:
 - Category = FAULTS.category2; blank -> '(uncategorised)'.
 - Breach % is over tickets that actually carried a resolution SLA
   (Slastate IN 'O','I'); 'O' = breached.
 - reopened uses the same portable definition as quality-scorecard.sql: a closed
   ticket that later had an action move OUT of a closed status after datecleared.
 - READING CAVEAT: long-running engagement categories (e.g. Consulting /
   Implementation) routinely show ~100% breach because their tickets stay open
   for weeks by design and the SLA clock isn't meaningful for them. The real
   coaching signal is the SPREAD between techs WITHIN the same reactive category
   (e.g. one tech breaching far more of the (uncategorised)/Support work than
   peers). Compare like-for-like within a category, not across categories.
 - HAVING filters out thin cells. Bot agents and deleted/merged tickets excluded.
*/
SELECT TOP 1000
    ISNULL(NULLIF(f.category2,''),'(uncategorised)')                  AS cat,
    u.uname                                                           AS tech,
    COUNT(*)                                                          AS resolved,
    SUM(CASE WHEN f.Slastate IN ('O','I') THEN 1 ELSE 0 END)         AS with_sla,
    CAST(100.0 * SUM(CASE WHEN f.Slastate = 'O' THEN 1 ELSE 0 END)
         / NULLIF(SUM(CASE WHEN f.Slastate IN ('O','I') THEN 1 ELSE 0 END),0)
         AS decimal(5,1))                                            AS sla_breach_pct,
    SUM(CASE WHEN EXISTS (
             SELECT 1 FROM ACTIONS ro
             WHERE ro.Faultid = f.Faultid
               AND ro.ActionStatusBefore IN (8,9,20)
               AND ro.ActionStatusAfter > 0
               AND ro.ActionStatusAfter NOT IN (8,9,20)
               AND ro.ActionDateCreated > f.datecleared
         ) THEN 1 ELSE 0 END)                                        AS reopened
FROM FAULTS f
JOIN UNAME u ON u.Unum = f.Clearwhoint
WHERE f.datecleared >= '2026-03-01'   /* EDIT: window start (inclusive) */
  AND f.datecleared <  '2026-06-01'   /* EDIT: window end   (exclusive) */
  AND f.datecleared > '1900-01-01'
  AND COALESCE(f.FDeleted,0) = 0
  AND COALESCE(f.FMergedIntoFaultid,0) = 0
  AND COALESCE(u.uisapiagent,0) = 0
GROUP BY ISNULL(NULLIF(f.category2,''),'(uncategorised)'), u.uname
HAVING SUM(CASE WHEN f.Slastate IN ('O','I') THEN 1 ELSE 0 END) >= 5   /* EDIT: min SLA'd tickets per cell */
ORDER BY sla_breach_pct DESC
