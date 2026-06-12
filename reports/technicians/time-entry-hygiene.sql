/*
TITLE:        Time-Entry Hygiene - Zero-Time & No-Notes Closes
WHAT IT ANSWERS:
              Of the tickets each technician resolved, what share were closed
              with NO time logged at all, and what share were closed with no
              substantive note on the ticket. Surfaces missing time capture
              (revenue leakage / unreliable utilisation) and silent closes.
KEY COLUMNS:  tech, resolved, zero_time_tickets, zero_time_pct,
              closed_no_notes, no_notes_pct
PARAMS:       @from / @to on datecleared  -- EDIT the two date literals below.
NOTES:
 - Population = tickets the tech CLOSED (Clearwhoint) in the window.
 - zero_time = SUM(timetaken) across ALL actions on the ticket is 0 or NULL.
   This is ticket-level (not per-action) so a ticket counts as "no time" only
   if nobody logged any time on it. A high zero_time_pct from a tech who closes
   real reactive work is the hygiene red flag.
 - closed_no_notes = the ticket has no ACTIONS row carrying a non-empty note.
   note is ntext, so it is CONVERTed to nvarchar(max) before LEN(). In practice
   most tickets carry at least an automated note, so this column tends to be 0 --
   a non-zero value is worth a look.
 - Excludes deleted/merged tickets and bot agents.
 - OUTER APPLY is used for the per-ticket roll-ups (portable, no CTE/variables).
 - Observed example: a tech closing >50% of tickets with zero time logged is a
   strong "time not being captured" signal even before judging effort.
*/
SELECT TOP 1000
    u.uname                                                            AS tech,
    COUNT(*)                                                           AS resolved,
    SUM(CASE WHEN tt.logged_hrs = 0 OR tt.logged_hrs IS NULL THEN 1 ELSE 0 END)                 AS zero_time_tickets,
    CAST(100.0 * SUM(CASE WHEN tt.logged_hrs = 0 OR tt.logged_hrs IS NULL THEN 1 ELSE 0 END)
         / COUNT(*) AS decimal(5,1))                                   AS zero_time_pct,
    SUM(CASE WHEN nn.note_actions = 0 OR nn.note_actions IS NULL THEN 1 ELSE 0 END)             AS closed_no_notes,
    CAST(100.0 * SUM(CASE WHEN nn.note_actions = 0 OR nn.note_actions IS NULL THEN 1 ELSE 0 END)
         / COUNT(*) AS decimal(5,1))                                   AS no_notes_pct
FROM FAULTS f
JOIN UNAME u ON u.Unum = f.Clearwhoint
OUTER APPLY (
    SELECT SUM(a.timetaken) AS logged_hrs
    FROM ACTIONS a WHERE a.Faultid = f.Faultid
) tt
OUTER APPLY (
    SELECT COUNT(*) AS note_actions
    FROM ACTIONS a2
    WHERE a2.Faultid = f.Faultid
      AND a2.note IS NOT NULL
      AND LEN(CONVERT(nvarchar(max), a2.note)) > 1
) nn
WHERE f.datecleared >= '2026-04-01'   /* EDIT: window start (inclusive) */
  AND f.datecleared <  '2026-06-01'   /* EDIT: window end   (exclusive) */
  AND f.dateoccured > '1900-01-01'
  AND COALESCE(f.FDeleted,0) = 0
  AND COALESCE(f.FMergedIntoFaultid,0) = 0
  AND COALESCE(u.uisapiagent,0) = 0
GROUP BY u.uname
ORDER BY zero_time_pct DESC
