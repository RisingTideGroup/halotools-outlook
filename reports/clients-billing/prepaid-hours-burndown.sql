/*
TITLE: Prepaid Hours Burn-Down — Purchased vs Consumed per Client
WHAT IT ANSWERS: For clients on prepaid (block-hour) arrangements, how many hours
  have been bought vs consumed, the net balance remaining, and which blocks are
  expiring. Flags clients at/over their prepaid limit.
KEY COLUMNS: client, hours_purchased, hours_consumed, hours_remaining,
  pct_consumed, earliest_active_expiry, flag
PARAMS:
  - Optional date floor on ppdate is omitted so the balance is lifetime-to-date.
    /* EDIT: add  AND pp.ppdate >= 'YYYY-01-01'  to scope to a contract year */
  - TOP 50 ordered by hours_remaining ascending (most over-burnt first) /* EDIT: TOP n */
NOTES:
  - PREPAYHISTORY is Halo's prepaid ledger keyed by ppareaint (= AREA.Aarea).
    pphours is SIGNED: positive rows = hours purchased / topped up, negative rows =
    hours consumed (burned by ticket actions). SUM(pphours) = current balance.
  - hours_remaining < 0 means the client has consumed more than they bought (you are
    delivering unbilled effort). hours_remaining near 0 = top-up due.
  - PPexpiryDate dates the block's expiry (many rows have none = non-expiring blocks).
    earliest_active_expiry only counts future-dated expiries.
  - Clients with no PREPAYHISTORY rows are not on prepaid and are excluded.
*/
SELECT TOP 50
  pp.ppareaint AS client_id,
  ar.aareadesc AS client,
  ROUND(SUM(CASE WHEN pp.pphours > 0 THEN pp.pphours ELSE 0 END), 2) AS hours_purchased,
  ROUND(SUM(CASE WHEN pp.pphours < 0 THEN -pp.pphours ELSE 0 END), 2) AS hours_consumed,
  ROUND(SUM(pp.pphours), 2) AS hours_remaining,
  CASE WHEN SUM(CASE WHEN pp.pphours > 0 THEN pp.pphours ELSE 0 END) > 0
       THEN ROUND(SUM(CASE WHEN pp.pphours < 0 THEN -pp.pphours ELSE 0 END)
                  / SUM(CASE WHEN pp.pphours > 0 THEN pp.pphours ELSE 0 END) * 100.0, 1)
       ELSE NULL END AS pct_consumed,
  MIN(CASE WHEN pp.PPexpiryDate > GETDATE() THEN pp.PPexpiryDate END) AS earliest_active_expiry,
  CASE
    WHEN SUM(pp.pphours) < 0 THEN 'OVER LIMIT'
    WHEN SUM(pp.pphours) <= 2 THEN 'TOP-UP DUE'
    ELSE 'OK'
  END AS flag
FROM PREPAYHISTORY pp
INNER JOIN AREA ar ON ar.Aarea = pp.ppareaint
GROUP BY pp.ppareaint, ar.aareadesc
ORDER BY hours_remaining ASC
