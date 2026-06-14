/*
TITLE: Top Categories by Volume AND by Total Time Spent
WHAT IT ANSWERS: Where does the service desk's effort actually go? Per category
  (category2), ticket count, total logged hours (SUM ACTIONS.timetaken), and
  average hours per ticket. Sort by volume or by hours to find the heavy hitters.
KEY COLUMNS: category, tickets, total_hrs, avg_hrs_per_ticket
PARAMS:
  /* EDIT: window start */ '2025-01-01' on dateoccured.
NOTES:
  - category2 is the primary category field in this tenant (hierarchical 'A>B>C'
    paths). category3/category4 are unused (0 rows); category5 is rare. categoryid2
    maps to CATEGORYDETAIL.CDid but the text in category2 is self-sufficient.
  - timetaken is hours logged per action; SUM across a ticket's actions = effort.
  - Blank category2 -> '(uncategorised)' so the uncategorised effort is visible.
  - A category that is high on BOTH tickets and hours is an automation/KB candidate
    (see recurring-problem-categories.sql for the explicit ranking).
*/
SELECT TOP 50
  CASE WHEN LTRIM(RTRIM(ISNULL(f.category2,''))) = '' THEN '(uncategorised)' ELSE f.category2 END AS category,
  COUNT(DISTINCT f.faultid) AS tickets,
  CAST(SUM(ISNULL(a.timetaken,0)) AS decimal(12,1)) AS total_hrs,
  CAST(SUM(ISNULL(a.timetaken,0)) / NULLIF(COUNT(DISTINCT f.faultid),0) AS decimal(10,2)) AS avg_hrs_per_ticket
FROM FAULTS f
JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
LEFT JOIN ACTIONS a ON a.faultid = f.faultid
WHERE f.fdeleted = f.fmergedintofaultid
  AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
  AND f.dateoccured >= '2025-01-01'  /* EDIT: window start */
GROUP BY CASE WHEN LTRIM(RTRIM(ISNULL(f.category2,''))) = '' THEN '(uncategorised)' ELSE f.category2 END
ORDER BY tickets DESC
