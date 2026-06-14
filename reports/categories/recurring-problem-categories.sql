/*
TITLE: Recurring-Problem Categories (Automation / KB Candidates)
WHAT IT ANSWERS: Which categories combine HIGH volume AND HIGH aggregate time -
  the sweet spot for an automation, runbook, or knowledge-base article that would
  pay back fastest. Ranks categories by a simple effort score (tickets x total
  hours) and surfaces the top candidates.
KEY COLUMNS: category, tickets, total_hrs, avg_hrs_per_ticket, effort_score
PARAMS:
  /* EDIT: window start */ '2025-01-01' on dateoccured.
  /* EDIT: min tickets */ HAVING ... >= 10 to require genuine recurrence.
NOTES:
  - effort_score = tickets * total_hrs, a rough "biggest prize" ordering; a category
    can rank high via many quick tickets (good automation target) or fewer heavy
    ones (good documentation/scoping target) - read tickets vs avg_hrs to tell which.
  - category2 is the primary category field; blank -> '(uncategorised)' (itself a
    huge "category" here and the first hygiene fix).
  - total_hrs = SUM ACTIONS.timetaken over the category's tickets.
*/
SELECT TOP 25
  CASE WHEN LTRIM(RTRIM(ISNULL(f.category2,''))) = '' THEN '(uncategorised)' ELSE f.category2 END AS category,
  COUNT(DISTINCT f.faultid) AS tickets,
  CAST(SUM(ISNULL(a.timetaken,0)) AS decimal(12,1)) AS total_hrs,
  CAST(SUM(ISNULL(a.timetaken,0)) / NULLIF(COUNT(DISTINCT f.faultid),0) AS decimal(10,2)) AS avg_hrs_per_ticket,
  CAST(COUNT(DISTINCT f.faultid) * SUM(ISNULL(a.timetaken,0)) AS decimal(18,1)) AS effort_score
FROM FAULTS f
JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
LEFT JOIN ACTIONS a ON a.faultid = f.faultid
WHERE f.fdeleted = f.fmergedintofaultid
  AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
  AND f.dateoccured >= '2025-01-01'  /* EDIT: window start */
GROUP BY CASE WHEN LTRIM(RTRIM(ISNULL(f.category2,''))) = '' THEN '(uncategorised)' ELSE f.category2 END
HAVING COUNT(DISTINCT f.faultid) >= 10  /* EDIT: min tickets */
ORDER BY effort_score DESC
