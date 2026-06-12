/*
TITLE: Ticket Reassignment / Bouncing
WHAT IT ANSWERS: Which tickets get passed around, and how much bouncing happens
  overall? Halo logs each owner change as an ACTION with Actoutcome='Re-Assign'.
  This counts those per ticket. Two outputs:
   (A) the worst-bounced tickets (this query);
   (B) a distribution summary (variant in NOTES).
KEY COLUMNS: faultid, client, current_agent, reassign_count, logged_hrs, status
DETECTION METHOD (validated):
  COUNT of ACTIONS rows with Actoutcome = 'Re-Assign' per faultid. There is no
  before/after-agent column on ACTIONS in this schema; 'Re-Assign' is the explicit
  reassignment outcome (3,224 such actions tenant-wide).
PARAMS:
  /* EDIT: window start */ '2025-01-01' on dateoccured.
  /* EDIT: min reassigns */ HAVING ... >= 2 to focus on genuine bouncing.
NOTES:
  - Reactive scope only.
  - DISTRIBUTION variant (how many tickets had 0/1/2/3+ reassigns):
      SELECT reassign_count, COUNT(*) AS tickets FROM (
        SELECT f.faultid,
          (SELECT COUNT(*) FROM ACTIONS a WHERE a.faultid=f.faultid AND a.Actoutcome='Re-Assign') AS reassign_count
        FROM FAULTS f JOIN REQUESTTYPE rt ON rt.RTid=f.requesttypenew
        WHERE f.fdeleted=f.fmergedintofaultid AND rt.RTIsProject=0 AND rt.RTIsOpportunity=0
          AND f.dateoccured >= '2025-01-01') x
      GROUP BY reassign_count
*/
SELECT TOP 200
  f.faultid,
  ar.aareadesc AS client,
  ua.uname     AS current_agent,
  ts.tstatusdesc AS status,
  (SELECT COUNT(*) FROM ACTIONS a WHERE a.faultid = f.faultid AND a.Actoutcome = 'Re-Assign') AS reassign_count,
  CAST(ISNULL((SELECT SUM(a2.timetaken) FROM ACTIONS a2 WHERE a2.faultid = f.faultid), 0) AS decimal(12,1)) AS logged_hrs
FROM FAULTS f
JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
LEFT JOIN AREA ar  ON ar.aarea = f.areaint
LEFT JOIN UNAME ua ON ua.unum  = f.assignedtoint
LEFT JOIN TSTATUS ts ON ts.Tstatus = f.status
WHERE f.fdeleted = f.fmergedintofaultid
  AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
  AND f.dateoccured >= '2025-01-01'  /* EDIT: window start */
  AND (SELECT COUNT(*) FROM ACTIONS a WHERE a.faultid = f.faultid AND a.Actoutcome = 'Re-Assign') >= 2  /* EDIT: min reassigns */
ORDER BY reassign_count DESC
