/*
TITLE: Ticket Throughput - Created vs Resolved per Month (Reactive)
WHAT IT ANSWERS: Are we keeping pace? Monthly count of reactive tickets created
  (by real open time, dateoccured) vs resolved (by datecleared) plus net change.
  Net > 0 means backlog grew that month.
KEY COLUMNS: ym (yyyy-MM), created, resolved, net_change
PARAMS:
  /* EDIT: window start */ '2025-01-01' appears twice (created floor + resolved floor)
NOTES:
  - Reactive scope = REQUESTTYPE.RTIsProject=0 AND RTIsOpportunity=0.
  - dateoccured is the real open time (datecreated is corrupt - never use it).
  - "created" and "resolved" are independent measures over the same calendar
    months but counted on different date fields, hence two separate sub-aggregates
    UNIONed; a ticket created in Jan and resolved in Mar contributes to both.
  - datecleared >= '1900-01-01' is Halo's "is actually cleared" guard (NULL/epoch = open).
  - STUB FILTER: instant-closed "Quick Time" stubs (datecleared = dateoccured) are
    time-log rows, not real lifecycle tickets (~90% of the cleared reactive set). They
    are excluded from BOTH the created and resolved counts so the throughput/pace
    numbers reflect genuine tickets. Predicate keeps real closed + all open tickets.
*/
SELECT
  m.ym,
  SUM(m.created)  AS created,
  SUM(m.resolved) AS resolved,
  SUM(m.created) - SUM(m.resolved) AS net_change
FROM (
  SELECT FORMAT(f.dateoccured, 'yyyy-MM') AS ym, 1 AS created, 0 AS resolved
  FROM FAULTS f
  JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
  WHERE f.fdeleted = f.fmergedintofaultid
    AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
    AND f.dateoccured >= '2025-01-01'  /* EDIT: window start */
    AND (f.datecleared > f.dateoccured OR f.datecleared IS NULL OR f.datecleared < '1900-01-01')  /* stub filter: drop instant-closed Quick Time stubs */
  UNION ALL
  SELECT FORMAT(f.datecleared, 'yyyy-MM') AS ym, 0 AS created, 1 AS resolved
  FROM FAULTS f
  JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
  WHERE f.fdeleted = f.fmergedintofaultid
    AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
    AND f.datecleared >= '2025-01-01'  /* EDIT: window start */
    AND f.datecleared > f.dateoccured  /* stub filter: drop instant-closed Quick Time stubs (resolved branch only sees cleared tickets) */
) m
GROUP BY m.ym
