/*
TITLE: Ticket Throughput - Created vs Resolved per ISO Week (Reactive)
WHAT IT ANSWERS: Weekly cadence of reactive ticket inflow vs outflow, ISO-week
  bucketed (Mon-start, ISO_WEEK), for spotting short-term surges the monthly
  rollup smooths over.
KEY COLUMNS: iso_year, iso_week, yr_wk (sortable yyyy-Www), created, resolved, net_change
PARAMS:
  /* EDIT: window start */ '2026-01-01' appears twice (created floor + resolved floor)
NOTES:
  - Reactive scope = RTIsProject=0 AND RTIsOpportunity=0.
  - DATEPART(ISO_WEEK,...) + YEAR() of the same date; near Jan 1 the ISO week can
    belong to the prior/next ISO year, so yr_wk uses calendar YEAR for a stable,
    roughly-correct sort label. Good enough for trend reading.
  - dateoccured = real open time; datecleared >= '1900-01-01' = actually cleared.
  - STUB FILTER: instant-closed "Quick Time" stubs (datecleared = dateoccured) are
    time-log rows, not real lifecycle tickets (~90% of the cleared reactive set). They
    are excluded from BOTH the created and resolved counts so the cadence numbers
    reflect genuine tickets. Predicate keeps real closed + all open tickets.
*/
SELECT
  m.cal_year                                            AS yr,
  m.iso_week,
  CONCAT(m.cal_year, '-W', RIGHT('0' + CAST(m.iso_week AS varchar(2)), 2)) AS yr_wk,
  SUM(m.created)  AS created,
  SUM(m.resolved) AS resolved,
  SUM(m.created) - SUM(m.resolved) AS net_change
FROM (
  SELECT YEAR(f.dateoccured) AS cal_year, DATEPART(ISO_WEEK, f.dateoccured) AS iso_week,
         1 AS created, 0 AS resolved
  FROM FAULTS f
  JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
  WHERE f.fdeleted = f.fmergedintofaultid
    AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
    AND f.dateoccured >= '2026-01-01'  /* EDIT: window start */
    AND (f.datecleared > f.dateoccured OR f.datecleared IS NULL OR f.datecleared < '1900-01-01')  /* stub filter: drop instant-closed Quick Time stubs */
  UNION ALL
  SELECT YEAR(f.datecleared), DATEPART(ISO_WEEK, f.datecleared), 0, 1
  FROM FAULTS f
  JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
  WHERE f.fdeleted = f.fmergedintofaultid
    AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
    AND f.datecleared >= '2026-01-01'  /* EDIT: window start */
    AND f.datecleared > f.dateoccured  /* stub filter: drop instant-closed Quick Time stubs (resolved branch only sees cleared tickets) */
) m
GROUP BY m.cal_year, m.iso_week
