/*
TITLE: Contract Register & Expiry Tracker
WHAT IT ANSWERS: Every client contract with its term, status and end date, flagging
  those approaching expiry so renewals can be actioned. Includes contracted hours
  and per-period charge where the MSP uses Halo's contract billing.
KEY COLUMNS: contract_id, client, CHstartdate, CHenddate, status, is_active,
  contract_ref, charge_hours_per_period, period_charge_amount, days_to_expiry, flag
PARAMS:
  - Expiry horizon: 90 days                              /* EDIT: warn window */
  - TOP 100 ordered by CHenddate ascending               /* EDIT: TOP n */
NOTES:
  - CONTRACTHEADER is the contract master; CHarea = AREA.Aarea.
  - CHstatus is an int: 3 = active/agreed, 5 = expired/cancelled (observed). chactive
    bit is the live flag. Status label mapping is tenant-configurable — verify against
    your tenant's contract status list before relying on the text.
  - CHenddate = 2099-12-31 denotes an open-ended / rolling contract (no fixed expiry);
    these are reported as 'ROLLING' rather than an expiry countdown.
  - chTermMonths holds the term length where set. CHChargeHoursPerPeriod = contracted
    hours per billing period (0 in tenants that meter via prepaid blocks instead).
  - Only contracts flagged active (chactive=1) are returned by default.
*/
SELECT TOP 100
  ch.CHid AS contract_id,
  ar.aareadesc AS client,
  ch.CHstartdate,
  ch.CHenddate,
  ch.CHstatus AS status,
  ch.chactive AS is_active,
  ch.CHcontractRef AS contract_ref,
  ch.chTermMonths AS term_months,
  ch.CHChargeHoursPerPeriod AS charge_hours_per_period,
  ch.CHPeriodChargeAmount AS period_charge_amount,
  CASE WHEN ch.CHenddate < '2099-01-01'
       THEN DATEDIFF(day, GETDATE(), ch.CHenddate) END AS days_to_expiry,
  CASE
    WHEN ch.CHenddate >= '2099-01-01' THEN 'ROLLING'
    WHEN ch.CHenddate < GETDATE() THEN 'EXPIRED'
    WHEN ch.CHenddate <= DATEADD(day, 90, GETDATE()) THEN 'EXPIRING SOON'  /* EDIT: horizon */
    ELSE 'OK'
  END AS flag
FROM CONTRACTHEADER ch
INNER JOIN AREA ar ON ar.Aarea = ch.CHarea
WHERE ch.chactive = 1   /* EDIT: drop to include inactive/historic contracts */
ORDER BY ch.CHenddate ASC
