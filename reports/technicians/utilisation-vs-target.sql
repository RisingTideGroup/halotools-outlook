/*
TITLE:        Technician Utilisation vs Billable Target (SQL proxy, per month)
WHAT IT ANSWERS:
              Per technician per month: total hours logged, billable hours, the
              tech's configured weekly billable target, the implied monthly
              target, and billable utilisation against it. The "are they hitting
              their billable number" view, computed entirely from the database.
KEY COLUMNS:  tech, ym, weekly_billable_target, monthly_billable_target,
              logged_hrs, billable_hrs, billable_utilisation_pct
PARAMS:       @from / @to on ActionDateCreated (EDIT below). Weeks-per-month
              factor (4.33) is EDITable.
NOTES:
 - Target source = UNAME.CFAgentRequiredBillableHours, a per-agent WEEKLY billable
   target stored as TEXT (TRY_CONVERT guards it). monthly target = weekly * 4.33.
   Agents with no target configured come back NULL and have no utilisation %.
 - billable_hrs = ActionChargeHours + ActionPrePayHours; logged_hrs = timetaken.
 - This is the DATABASE-NATIVE utilisation proxy. The AUTHORITATIVE utilisation
   (actual worked vs available/target hours, with shifts & breaks) lives in
   Halo's REST /Timesheet endpoint, which returns per-agent-per-day
   target_hours / actual_hours / chargeable_hours and is NOT reachable from SQL.
   For true available-hours utilisation, pull /Timesheet (e.g. listTimesheets)
   and aggregate chargeable_hours / target_hours per agent. Use this SQL report
   when you want a quick billable-vs-target read without leaving Report Center.
 - CAVEAT: time-entry hygiene contaminates this -- a tech who logs little time
   (see time-entry-hygiene.sql, e.g. >50% zero-time closes) will look
   under-utilised here even if busy. Read the two together.
 - Bot agents excluded. agent_id in /Timesheet == UNAME.Unum if you want to join.
*/
SELECT TOP 1000
    u.uname                                                            AS tech,
    CONVERT(char(7), a.ActionDateCreated, 126)                         AS ym,
    TRY_CONVERT(decimal(10,1), u.CFAgentRequiredBillableHours)         AS weekly_billable_target,
    CAST(TRY_CONVERT(decimal(10,1), u.CFAgentRequiredBillableHours) * 4.33 AS decimal(10,1)) AS monthly_billable_target,
    CAST(SUM(ISNULL(a.timetaken,0)) AS decimal(12,1))                  AS logged_hrs,
    CAST(SUM(ISNULL(a.ActionChargeHours,0) + ISNULL(a.ActionPrePayHours,0)) AS decimal(12,1)) AS billable_hrs,
    CAST(100.0 * SUM(ISNULL(a.ActionChargeHours,0) + ISNULL(a.ActionPrePayHours,0))
         / NULLIF(TRY_CONVERT(decimal(10,1), u.CFAgentRequiredBillableHours) * 4.33, 0)
         AS decimal(6,1))                                              AS billable_utilisation_pct
FROM ACTIONS a
JOIN UNAME u ON u.Unum = a.whoagentid
WHERE a.ActionDateCreated >= '2026-03-01'   /* EDIT: window start (inclusive) */
  AND a.ActionDateCreated <  '2026-06-01'   /* EDIT: window end   (exclusive) */
  AND COALESCE(u.uisapiagent,0) = 0
GROUP BY u.uname, u.CFAgentRequiredBillableHours, CONVERT(char(7), a.ActionDateCreated, 126)
ORDER BY u.uname, CONVERT(char(7), a.ActionDateCreated, 126)
