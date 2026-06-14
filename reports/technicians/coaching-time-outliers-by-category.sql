/*
TITLE:        Coaching Signal - Slow-by-Category Outliers (tech vs team median)
WHAT IT ANSWERS:
              For each technician x ticket category, the tech's MEDIAN wall-clock
              resolution time vs the TEAM median for that same category, and the
              gap between them. Large positive deltas flag where one tech is an
              outlier-slow handler of a category -- a likely knowledge gap to coach.
KEY COLUMNS:  cat, tech, tickets, tech_median_hrs, team_median_hrs, delta_hrs
PARAMS:       @from / @to on datecleared (EDIT below); min ticket threshold (EDIT
              the "tickets >= 4" filter to require more/less evidence per cell).
NOTES:
 - Category = FAULTS.category2 (the primary category string). NULL/blank is
   bucketed as '(uncategorised)'. Most auto-closed Alert tickets land there with
   ~0 resolution, so the '(uncategorised)' row is mostly noise -- focus on the
   named categories (e.g. Halo>Consulting>Optimization, Halo>Implementation>...).
 - MEDIAN, not average: wall-clock resolution has extreme right-tail outliers
   (tickets resolved long after they were opened). Median per-ticket is the fair
   comparison. PERCENTILE_CONT is used as a window; DISTINCT collapses the
   per-ticket duplicate rows the window otherwise produces.
 - Compares like-for-like: a tech is only "slow" relative to the SAME category's
   team median, so category mix differences don't create false positives.
 - tickets = how many the tech resolved in that category (evidence weight).
 - STUB FILTER: instant-closed "Quick Time" stubs (datecleared = dateoccured) are
   time-log rows with ~0 resolution span, not real lifecycle tickets; they would
   collapse the medians. Excluded via datecleared > dateoccured in BOTH inner queries
   (keep the two in sync). This is a pure resolution-time report, no hours columns.
 - Bot agents and deleted/merged tickets excluded.
 - To focus on reactive support only, add to BOTH inner queries:
     JOIN REQUESTTYPE rt ON rt.RTid = f.Requesttype
     AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0  (optionally rt.RTDesc <> 'Alert')
*/
SELECT TOP 1000
    t.cat,
    t.tech,
    t.tickets,
    t.tech_median_hrs,
    c.team_median_hrs,
    CAST(t.tech_median_hrs - c.team_median_hrs AS decimal(12,2)) AS delta_hrs
FROM (
    SELECT DISTINCT
        cat,
        tech,
        COUNT(*) OVER (PARTITION BY cat, tech)                                  AS tickets,
        CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY res_hrs)
             OVER (PARTITION BY cat, tech) AS decimal(12,2))                    AS tech_median_hrs
    FROM (
        SELECT
            ISNULL(NULLIF(f.category2,''),'(uncategorised)') AS cat,
            u.uname                                          AS tech,
            DATEDIFF(minute, f.dateoccured, f.datecleared) / 60.0 AS res_hrs
        FROM FAULTS f
        JOIN UNAME u ON u.Unum = f.Clearwhoint
        WHERE f.datecleared >= '2026-03-01'   /* EDIT: window start (inclusive) */
          AND f.datecleared <  '2026-06-01'   /* EDIT: window end   (exclusive) */
          AND f.dateoccured > '1900-01-01'
          AND f.datecleared > f.dateoccured   /* stub filter: drop instant-closed Quick Time stubs */
          AND COALESCE(f.FDeleted,0) = 0
          AND COALESCE(f.FMergedIntoFaultid,0) = 0
          AND COALESCE(u.uisapiagent,0) = 0
    ) p
) t
JOIN (
    SELECT DISTINCT
        cat,
        CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY res_hrs)
             OVER (PARTITION BY cat) AS decimal(12,2))                          AS team_median_hrs
    FROM (
        SELECT
            ISNULL(NULLIF(f.category2,''),'(uncategorised)') AS cat,
            DATEDIFF(minute, f.dateoccured, f.datecleared) / 60.0 AS res_hrs
        FROM FAULTS f
        JOIN UNAME u ON u.Unum = f.Clearwhoint
        WHERE f.datecleared >= '2026-03-01'   /* EDIT: keep in sync with above */
          AND f.datecleared <  '2026-06-01'   /* EDIT: keep in sync with above */
          AND f.dateoccured > '1900-01-01'
          AND f.datecleared > f.dateoccured   /* stub filter: drop instant-closed Quick Time stubs */
          AND COALESCE(f.FDeleted,0) = 0
          AND COALESCE(f.FMergedIntoFaultid,0) = 0
          AND COALESCE(u.uisapiagent,0) = 0
    ) pc
) c ON c.cat = t.cat
WHERE t.tickets >= 4                       /* EDIT: min tickets per tech-category cell */
ORDER BY t.tech_median_hrs - c.team_median_hrs DESC
