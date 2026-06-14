/*
TITLE: First-Time-Fix Rate by Category
WHAT IT ANSWERS: Per category (category2), what share of resolved reactive tickets
  were fixed "first time" - i.e. never reopened and never reassigned. Low FTF on a
  high-volume category points at a knowledge gap or wrong-routing problem.
KEY COLUMNS: category, resolved, first_time_fix, ftf_rate_pct
FTF DEFINITION (this tenant):
  A resolved ticket is a first-time fix when BOTH:
   - it was never reopened: no ACTIONS row with ActionStatusBefore IN (8,9) ->
     ActionStatusAfter NOT IN (8,9); AND
   - it was never reassigned: no ACTIONS row with Actoutcome='Re-Assign'.
  (Halo has no native FTF flag; these two ACTIONS signals are the validated proxies
  used elsewhere in this report set.)
PARAMS:
  /* EDIT: window start */ '2025-01-01' on datecleared (resolved in window).
  /* EDIT: closed status ids */ (8,9).
NOTES:
  - Uncategorised tickets (blank category2) are grouped as '(uncategorised)'.
  - Only genuinely resolved tickets count (datecleared in window AND datecleared > dateoccured).
  - STUB FILTER: instant-closed "Quick Time" stubs (datecleared = dateoccured) are
    time-log rows, not real lifecycle closes (~90% of the cleared reactive set). They
    are trivially "first-time fixes" (never reopened/reassigned) and would massively
    inflate the FTF rate, so they are excluded via datecleared > dateoccured.
*/
SELECT TOP 50
  CASE WHEN LTRIM(RTRIM(ISNULL(f.category2,''))) = '' THEN '(uncategorised)' ELSE f.category2 END AS category,
  COUNT(*) AS resolved,
  SUM(CASE WHEN ro.faultid IS NULL AND ra.faultid IS NULL THEN 1 ELSE 0 END) AS first_time_fix,
  CAST(100.0 * SUM(CASE WHEN ro.faultid IS NULL AND ra.faultid IS NULL THEN 1 ELSE 0 END)
       / NULLIF(COUNT(*), 0) AS decimal(5,1)) AS ftf_rate_pct
FROM FAULTS f
JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
LEFT JOIN (
  SELECT DISTINCT a.faultid FROM ACTIONS a
  WHERE a.ActionStatusBefore IN (8,9) AND a.ActionStatusAfter NOT IN (8,9) AND a.ActionStatusAfter > 0  /* EDIT: closed status ids */
) ro ON ro.faultid = f.faultid
LEFT JOIN (
  SELECT DISTINCT a.faultid FROM ACTIONS a WHERE a.Actoutcome = 'Re-Assign'
) ra ON ra.faultid = f.faultid
WHERE f.fdeleted = f.fmergedintofaultid
  AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
  AND f.datecleared >= '2025-01-01'  /* EDIT: window start */
  AND f.datecleared > f.dateoccured  /* stub filter: drop instant-closed Quick Time stubs */
GROUP BY CASE WHEN LTRIM(RTRIM(ISNULL(f.category2,''))) = '' THEN '(uncategorised)' ELSE f.category2 END
HAVING COUNT(*) >= 10  /* EDIT: min resolved for a stable rate */
ORDER BY resolved DESC
