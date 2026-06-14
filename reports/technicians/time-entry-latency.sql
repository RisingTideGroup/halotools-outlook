/*
TITLE: Technician time-entry latency (real-time logging discipline)

WHAT IT ANSWERS: Per technician, how promptly time is logged — the gap between
  when work was done (ACTIONS.Whe_) and when the entry was created
  (ACTIONS.ActionDateCreated) — plus how often entries are edited well after
  creation (ACTIONS.ALastUpdated). Flags techs who batch-enter or back-fill time
  rather than logging in real time.

KEY COLUMNS:
  tech, time_entries,
  avg_lag_hrs        - mean hours between work date (Whe_) and entry creation
  pct_realtime       - % of entries created within 1h of the work date
  over_1d_late       - entries created >1 day after the work date
  edited_10min_plus  - entries whose ALastUpdated is >10 min after creation
  edited_1day_plus   - entries whose ALastUpdated is >1 day after creation (real back-edits)

PARAMS:
  Window is on Whe_ (work date).            /* EDIT: date window */
  Minimum entries per tech to list.         /* EDIT: HAVING count >= 5 */
  Edit threshold (24h) clears the automation's few-minute touch. /* EDIT */

NOTES:
 - Whe_ is a tech-settable work date. HIGH lag reliably means "logged late"; LOW
   lag can mean real-time logging OR simply not setting an accurate work date, so
   treat low lag as good-but-unconfirmed and high lag as a solid flag.
 - This tenant runs an automation that updates every action a few minutes after
   creation, so ALastUpdated within ~minutes is the automation, not a human. The
   edited_1day_plus count clears that window and reflects genuine back-edits.
 - For precise "who edited" attribution, the AUDIT table has AUnum (the editor) +
   atablename='actions' + ADate; join AUnum -> UNAME and filter
   COALESCE(uisapiagent,0)=0 to isolate real-agent edits from automations.
 - Bots/API agents are excluded via COALESCE(uisapiagent,0)=0; only time-carrying
   actions (timetaken > 0) are counted.
*/
select u.uname as tech,
  count(*) as time_entries,
  cast(avg(datediff(minute, a.Whe_, a.ActionDateCreated) / 60.0) as decimal(10,1)) as avg_lag_hrs,
  cast(100.0 * sum(case when datediff(hour, a.Whe_, a.ActionDateCreated) <= 1 then 1 else 0 end) / count(*) as decimal(5,1)) as pct_realtime,
  sum(case when datediff(hour, a.Whe_, a.ActionDateCreated) > 24 then 1 else 0 end) as over_1d_late,
  sum(case when a.ALastUpdated > dateadd(minute, 10, a.ActionDateCreated) then 1 else 0 end) as edited_10min_plus,
  sum(case when a.ALastUpdated > dateadd(hour, 24, a.ActionDateCreated) then 1 else 0 end) as edited_1day_plus
from actions a
join uname u on a.whoagentid = u.unum
where coalesce(u.uisapiagent, 0) = 0
  and a.timetaken > 0
  and a.Whe_ >= '2026-05-13' and a.Whe_ < '2026-06-13'  /* EDIT: date window (on work date Whe_) */
group by u.uname
having count(*) >= 5  /* EDIT: minimum entries to list a tech */
order by avg(datediff(minute, a.Whe_, a.ActionDateCreated) / 60.0) desc
offset 0 rows
