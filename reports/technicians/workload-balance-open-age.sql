/*
TITLE:        Current Workload Balance & Open-Ticket Age Distribution
WHAT IT ANSWERS:
              A point-in-time snapshot of how many OPEN tickets each tech owns,
              broken into age buckets (0-7d / 8-30d / 31-90d / 90d+) with their
              average age. Spots overload, hoarding, and ageing backlogs.
KEY COLUMNS:  tech, open_owned, age_0_7d, age_8_30d, age_31_90d, age_90d_plus,
              avg_age_days
PARAMS:       None time-window (it's "as of now"). Age buckets are EDITable in
              the CASE expressions. To scope to reactive work only, add a
              REQUESTTYPE join (see NOTES).
NOTES:
 - Open = datecleared NULL or < '1900-01-01' (Halo's empty-date sentinel).
 - Ownership = Assignedtoint (current owner). Age uses dateoccured (the true
   open time -- datecreated is unreliable for durations in this schema).
 - The 'Unassigned' pseudo-agent (Unum=1) is excluded; it otherwise holds the
   bulk of auto-generated Alert tickets and would dwarf everything. If you want
   to see that pool, drop the "u.Unum > 1" filter.
 - Many of the 90d+ tickets here are long-lived Alert/monitoring or
   project/parked items rather than neglected support. To focus on reactive
   support, add:
     JOIN REQUESTTYPE rt ON rt.RTid = f.Requesttype
     AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0 AND rt.RTDesc <> 'Alert'
 - Bot agents and deleted/merged tickets excluded.
*/
SELECT TOP 1000
    u.uname AS tech,
    COUNT(*)                                                                       AS open_owned,
    SUM(CASE WHEN DATEDIFF(day, f.dateoccured, GETDATE()) <= 7  THEN 1 ELSE 0 END) AS age_0_7d,
    SUM(CASE WHEN DATEDIFF(day, f.dateoccured, GETDATE()) BETWEEN 8 AND 30  THEN 1 ELSE 0 END) AS age_8_30d,
    SUM(CASE WHEN DATEDIFF(day, f.dateoccured, GETDATE()) BETWEEN 31 AND 90 THEN 1 ELSE 0 END) AS age_31_90d,
    SUM(CASE WHEN DATEDIFF(day, f.dateoccured, GETDATE()) > 90  THEN 1 ELSE 0 END) AS age_90d_plus,
    CAST(AVG(DATEDIFF(day, f.dateoccured, GETDATE()) * 1.0) AS decimal(10,1))      AS avg_age_days
FROM FAULTS f
JOIN UNAME u ON u.Unum = f.Assignedtoint
WHERE (f.datecleared IS NULL OR f.datecleared < '1900-01-01')
  AND f.dateoccured > '1900-01-01'
  AND COALESCE(f.FDeleted,0) = 0
  AND COALESCE(f.FMergedIntoFaultid,0) = 0
  AND COALESCE(u.uisapiagent,0) = 0
  AND u.Unum > 1                       /* drop the Unassigned pseudo-agent */
GROUP BY u.uname
ORDER BY open_owned DESC
