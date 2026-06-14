/*
TITLE: Retroactive time-entry edits by real agents (audit-trail forensic)

WHAT IT ANSWERS: Which agents go back and modify time-carrying actions well
  after they were created — the "quietly changing logged hours days later"
  signal. Uses Halo's AUDIT trail with the editor's identity, so it sees who
  actually made the change (not just that the row changed), and excludes the
  tenant's automations/bots.

KEY COLUMNS:
  editor                    - the agent who made the edit (AUDIT.AUnum -> UNAME)
  time_actions_retro_edited - distinct time-carrying actions they edited >1 day after creation
  audit_rows                - total audit events behind that (an action may be edited several times)

HOW IT JOINS (Halo audit idioms):
  AUDIT logs each change with atablename + the changed row's key. For
  atablename='actions', apkid1 = FAULTS.faultid and apkid2 = ACTIONS.actionnumber
  (the action's per-ticket number). AUnum is the EDITOR; join to UNAME and filter
  COALESCE(uisapiagent,0)=0 to drop bots/integrations (e.g. the AI/automation that
  stamps last_updated, Message ID, AI Summary seconds after creation). ADate is
  when the edit happened; ActionDateCreated is when the action was created.

PARAMS:
  Window is on the EDIT date (ADate).        /* EDIT: a.ADate >= ... */
  Edit threshold (24h after creation) clears the automation window. /* EDIT */

NOTES / CAVEATS:
 - This proves a REAL agent modified a TIME-CARRYING action long after creating
   it. It does NOT prove the timetaken field itself changed — Halo's audit does
   not log an isolated "Time Taken" field event in this tenant, so treat a high
   count as "investigate these tickets", not proof of time manipulation.
 - 'Action ID % Created' / 'Deleted' audit rows are excluded so only post-creation
   field edits count.
 - Group is by the EDITOR. To see whether they edited their OWN time vs someone
   else's, also compare AUDIT.AUnum against ACTIONS.whoagentid.
*/
select u.uname as editor,
  count(distinct act.id) as time_actions_retro_edited,
  count(*) as audit_rows
from audit a
join uname u on a.AUnum = u.unum
join actions act on act.faultid = a.apkid1 and act.actionnumber = a.apkid2
where a.atablename = 'actions'
  and coalesce(u.uisapiagent, 0) = 0
  and act.timetaken > 0
  and a.AValue not like 'Action ID%'
  and a.ADate > dateadd(hour, 24, act.ActionDateCreated)
  and a.ADate >= '2026-03-14'  /* EDIT: window on the edit date */
group by u.uname
order by count(distinct act.id) desc
offset 0 rows
