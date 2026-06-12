/*
TITLE:        Technician Quality Scorecard
WHAT IT ANSWERS:
              Per technician (by who resolved the ticket): reopen rate,
              resolution-SLA breach rate, first-response-SLA breach rate,
              average AI CSAT, and median + average wall-clock resolution time.
KEY COLUMNS:  tech, resolved, reopened, res_sla_breach_pct, fr_sla_breach_pct,
              avg_csat, median_res_hrs, avg_res_hrs
PARAMS:       @from / @to on datecleared  -- EDIT the two date literals below.
NOTES:
 - Population = tickets this tech CLOSED (Clearwhoint) in the window.
 - REOPEN definition: a ticket counts as reopened if, AFTER its datecleared,
   an ACTIONS row moved its status OUT of a closed/resolved status
   (ActionStatusBefore IN 8 Resolved / 9 Closed / 20 Completed) into any other
   live status. Schema-portable (no tenant-specific status text).
   CAVEAT: reopens are RARE in this tenant; reopen count often reads 0 -- treat
   any non-zero as the signal rather than expecting a meaningful percentage.
 - SLA: Slastate = resolution SLA, Fslafirstresponsestate = first-response SLA.
   'O' breached, 'I' met, '' no SLA. Breach % is computed only over tickets
   that actually HAD that SLA.
 - CSAT: faisatisfactionlevel is stored as TEXT (1-10); TRY_CONVERT guards the
   non-numeric rows. Averaged where populated.
 - Resolution time = wall-clock DATEDIFF(dateoccured -> datecleared)/60. MEDIAN
   is the headline (avg is dragged up by long-dormant tickets resolved late);
   both shown. The PERCENTILE_CONT window is constant within a tech, so MAX()
   simply lifts it through the GROUP BY.
 - Excludes deleted/merged tickets and bot agents (COALESCE(uisapiagent,0)=0).
*/
SELECT TOP 1000
    q.tech,
    COUNT(*)                                                            AS resolved,
    SUM(q.is_reopened)                                                  AS reopened,
    CAST(100.0 * SUM(q.res_breach) / NULLIF(SUM(q.has_res_sla),0) AS decimal(5,1)) AS res_sla_breach_pct,
    CAST(100.0 * SUM(q.fr_breach)  / NULLIF(SUM(q.has_fr_sla),0)  AS decimal(5,1)) AS fr_sla_breach_pct,
    CAST(AVG(q.csat) AS decimal(4,2))                                  AS avg_csat,
    CAST(MAX(q.tech_median) AS decimal(12,1))                          AS median_res_hrs,
    CAST(AVG(q.res_hrs) AS decimal(12,1))                              AS avg_res_hrs
FROM (
    SELECT
        u.uname AS tech,
        DATEDIFF(minute, f.dateoccured, f.datecleared) / 60.0 AS res_hrs,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY DATEDIFF(minute, f.dateoccured, f.datecleared) / 60.0)
            OVER (PARTITION BY u.uname)                       AS tech_median,
        CASE WHEN f.Slastate = 'O' THEN 1 ELSE 0 END          AS res_breach,
        CASE WHEN f.Slastate IN ('O','I') THEN 1 ELSE 0 END   AS has_res_sla,
        CASE WHEN f.Fslafirstresponsestate = 'O' THEN 1 ELSE 0 END        AS fr_breach,
        CASE WHEN f.Fslafirstresponsestate IN ('O','I') THEN 1 ELSE 0 END AS has_fr_sla,
        CASE WHEN TRY_CONVERT(float, f.faisatisfactionlevel) BETWEEN 1 AND 10
             THEN TRY_CONVERT(float, f.faisatisfactionlevel) END          AS csat,
        CASE WHEN EXISTS (
                 SELECT 1 FROM ACTIONS ro
                 WHERE ro.Faultid = f.Faultid
                   AND ro.ActionStatusBefore IN (8,9,20)
                   AND ro.ActionStatusAfter > 0
                   AND ro.ActionStatusAfter NOT IN (8,9,20)
                   AND ro.ActionDateCreated > f.datecleared
             ) THEN 1 ELSE 0 END                              AS is_reopened
    FROM FAULTS f
    JOIN UNAME u ON u.Unum = f.Clearwhoint
    WHERE f.datecleared >= '2026-03-01'   /* EDIT: window start (inclusive) */
      AND f.datecleared <  '2026-06-01'   /* EDIT: window end   (exclusive) */
      AND f.dateoccured > '1900-01-01'
      AND COALESCE(f.FDeleted,0) = 0
      AND COALESCE(f.FMergedIntoFaultid,0) = 0
      AND COALESCE(u.uisapiagent,0) = 0
) q
GROUP BY q.tech
ORDER BY res_sla_breach_pct DESC
