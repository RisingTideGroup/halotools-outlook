/*
TITLE:        Disengagement / Under-Performance Signals
WHAT IT ANSWERS:
              One per-tech row blending the signals an owner uses to spot a
              checked-out tech: tickets resolved vs the team median, hours
              logged, average first-response latency, count of OWNED open tickets
              sitting untouched 3+ days, and the after-hours share of activity.
KEY COLUMNS:  tech, resolved, resolved_vs_peer_median, hrs_logged,
              avg_first_resp_hrs, open_owned, stale_3d_plus, after_hours_pct
PARAMS:       @from / @to window (EDIT below). Staleness threshold (EDIT the
              "3" in DATEDIFF >= 3) and after-hours window (EDIT hour bounds).
NOTES:
 - resolved / hrs_logged / first-response / after-hours are windowed on activity
   in the period; open_owned / stale are a POINT-IN-TIME snapshot of currently
   open tickets the tech owns (Assignedtoint), independent of the window.
 - resolved_vs_peer_median = this tech's resolved minus the median resolved
   across the listed techs. Negative = below the pack (a soft idleness flag).
 - stale_3d_plus = open owned tickets whose last action (Flastactiondate) is 3+
   days old -- the "sitting untouched / hoarding" signal.
 - "resolved" lives in its own correlated subquery on purpose: combining the
   outer u.Unum with f.Faultid inside one aggregate is rejected by SQL Server.
 - after_hours_pct denominator and numerator both range over ALL of the tech's
   actions in the window, so the percentage is well-formed (0-100).
 - CAVEATS on reading this as "lazy":
   1. ActionDateCreated / ffirstresponsedate are stored UTC-ish, so
      after_hours_pct reflects the team's timezone/work pattern as much as
      behaviour (this team books heavily in the evening). Treat it as a
      work-PATTERN flag, not an effort verdict.
   2. avg_first_resp_hrs is inflated by auto-generated Alert tickets nobody
      "responds" to; to de-noise, add to the ACTIONS/FAULTS join:
        AND f.Requesttype <> 21   (the Alert request type in this tenant)
      or join REQUESTTYPE and filter rt.RTDesc <> 'Alert'.
   3. Low resolved can mean harder tickets, not idleness -- read alongside
      hrs_logged and the utilisation report.
 - Excludes bot agents and the 'Unassigned' pseudo-agent (Unum=1); excludes
   deleted/merged tickets.
*/
SELECT TOP 1000
    u.uname AS tech,
    r.resolved,
    r.resolved - PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r.resolved) OVER () AS resolved_vs_peer_median,
    w.hrs_logged,
    w.avg_first_resp_hrs,
    o.open_owned,
    o.stale_3d_plus,
    w.after_hours_pct
FROM UNAME u
OUTER APPLY (
    SELECT COUNT(*) AS resolved
    FROM FAULTS fr
    WHERE fr.Clearwhoint = u.Unum
      AND fr.datecleared >= '2026-05-01'   /* EDIT: window start (inclusive) */
      AND fr.datecleared <  '2026-06-01'   /* EDIT: window end   (exclusive) */
      AND fr.datecleared > '1900-01-01'
      AND COALESCE(fr.FDeleted,0)=0 AND COALESCE(fr.FMergedIntoFaultid,0)=0
) r
OUTER APPLY (
    SELECT
        CAST(SUM(ISNULL(a.timetaken,0)) AS decimal(12,2))                        AS hrs_logged,
        CAST(100.0 * SUM(CASE WHEN DATEPART(weekday,a.ActionDateCreated) IN (1,7)
                                OR DATEPART(hour,a.ActionDateCreated) < 8
                                OR DATEPART(hour,a.ActionDateCreated) >= 18
                              THEN 1 ELSE 0 END)
             / NULLIF(COUNT(*),0) AS decimal(5,1))                               AS after_hours_pct,
        CAST(AVG(CASE WHEN f.ffirstresponsedate > '1900-01-01'
                      THEN DATEDIFF(minute, f.dateoccured, f.ffirstresponsedate)/60.0 END)
             AS decimal(12,1))                                                   AS avg_first_resp_hrs
    FROM ACTIONS a
    LEFT JOIN FAULTS f ON f.Faultid = a.Faultid
                      AND COALESCE(f.FDeleted,0)=0 AND COALESCE(f.FMergedIntoFaultid,0)=0
    WHERE a.whoagentid = u.Unum
      AND a.ActionDateCreated >= '2026-05-01'   /* EDIT: keep in sync with above */
      AND a.ActionDateCreated <  '2026-06-01'   /* EDIT: keep in sync with above */
) w
OUTER APPLY (
    SELECT
        COUNT(*) AS open_owned,
        SUM(CASE WHEN DATEDIFF(day, f2.Flastactiondate, GETDATE()) >= 3 THEN 1 ELSE 0 END) AS stale_3d_plus
    FROM FAULTS f2
    WHERE f2.Assignedtoint = u.Unum
      AND (f2.datecleared IS NULL OR f2.datecleared < '1900-01-01')
      AND COALESCE(f2.FDeleted,0)=0 AND COALESCE(f2.FMergedIntoFaultid,0)=0
) o
WHERE COALESCE(u.uisapiagent,0) = 0
  AND u.Unum > 1                       /* drop the Unassigned pseudo-agent */
  AND (r.resolved > 0 OR o.open_owned > 0)
ORDER BY r.resolved ASC
