/*
TITLE: Client Profitability — Recurring Revenue vs Delivered Labour
WHAT IT ANSWERS: Per client, monthly-normalised recurring revenue (MRR) against
  labour hours delivered over a trailing window, and the effective hourly rate
  (MRR / hours delivered). Ranked least-to-most profitable so the loss-leaders
  surface at the top.
KEY COLUMNS: client, mrr, hours_delivered, charge_amount, eff_rate_per_hr
PARAMS:
  - Labour window: ACTIONS within the last 3 months  /* EDIT: DATEADD(month,-3,...) */
  - TOP 50 ordered by eff_rate_per_hr ascending       /* EDIT: TOP n */
NOTES:
  - MRR normalisation maps the RecurringInvoices view's friendly Period string to a
    monthly figure (Yearly/12, Quarterly/3, Weekly*52/12, Half-Yearly/6, Two-Yearly/24).
    Blank/unknown periods are treated as monthly (the safe default for this tenant).
  - RecurringInvoices is Halo's active recurring-revenue view; disabled lines are
    already excluded. [Net Price] is the per-period net (ex-tax) amount.
  - timetaken is in HOURS. There is NO agent labour-COST column in this tenant
    (AGENT and ACTIONS carry charge/revenue only), so "profit" here is revenue vs
    DELIVERED EFFORT, not revenue minus cost. eff_rate_per_hr is a yield proxy:
    low value = lots of effort for little recurring revenue.
  - charge_amount = ad-hoc/PAYG billable charges logged on actions (on top of MRR).
  - Excludes deleted/merged tickets. Clients with zero recurring revenue are excluded
    (INNER JOIN to revenue); use the over-servicing report to catch zero-MRR clients.
*/
SELECT TOP 50
  ar.Aarea AS client_id,
  ar.aareadesc AS client,
  ROUND(rev.mrr, 2) AS mrr,
  ROUND(lab.hours_delivered, 1) AS hours_delivered,
  ROUND(lab.charge_amount, 2) AS charge_amount,
  CASE WHEN lab.hours_delivered > 0
       THEN ROUND(rev.mrr / lab.hours_delivered, 2)
       ELSE NULL END AS eff_rate_per_hr
FROM AREA ar
INNER JOIN (
  SELECT [Customer ID] AS cid,
    SUM(CASE [Period]
          WHEN 'Monthly'     THEN [Net Price]
          WHEN 'Yearly'      THEN [Net Price] / 12.0
          WHEN 'Quarterly'   THEN [Net Price] / 3.0
          WHEN 'Weekly'      THEN [Net Price] * 52.0 / 12.0
          WHEN 'Half-Yearly' THEN [Net Price] / 6.0
          WHEN 'Two-Yearly'  THEN [Net Price] / 24.0
          ELSE [Net Price]
        END) AS mrr
  FROM RecurringInvoices
  GROUP BY [Customer ID]
) rev ON rev.cid = ar.Aarea
LEFT JOIN (
  SELECT f.Areaint AS aid,
    SUM(a.timetaken) AS hours_delivered,
    SUM(a.ActionChargeAmount) AS charge_amount
  FROM ACTIONS a
  INNER JOIN FAULTS f ON f.Faultid = a.Faultid
  WHERE f.FDeleted = 0
    AND f.FMergedIntoFaultid = 0
    AND a.ActionDateCreated >= DATEADD(month, -3, GETDATE())  /* EDIT: labour window */
  GROUP BY f.Areaint
) lab ON lab.aid = ar.Aarea
ORDER BY eff_rate_per_hr ASC
