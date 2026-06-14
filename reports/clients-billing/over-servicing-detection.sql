/*
TITLE: Over-Servicing Detection — Hours Delivered vs Recurring Revenue
WHAT IT ANSWERS: Which clients consume a lot of support effort relative to what
  they pay in recurring revenue. Surfaces money-losing relationships and clients
  on flat-fee/managed plans who are heavy users. Includes zero-MRR clients that
  still generate labour (LEFT JOIN keeps them).
KEY COLUMNS: client, mrr, hours_delivered, charge_amount, hours_per_100_mrr, flag
PARAMS:
  - Window: ACTIONS in the last 3 months              /* EDIT: DATEADD(month,-3,...) */
  - Minimum hours to appear: 2                          /* EDIT: HAVING threshold */
  - TOP 50 ordered by hours_per_100_mrr descending      /* EDIT: TOP n */
NOTES:
  - hours_per_100_mrr = delivered hours per GBP 100 of MRR. Higher = more effort per
    revenue dollar = more likely over-serviced. Zero-MRR clients get NULL there and
    are flagged 'NO RECURRING REVENUE' (pure cost unless billed ad-hoc via charge_amount).
  - This is the inverse lens of client-profitability.sql; keep both.
  - MRR normalisation and exclusions identical to the profitability report.
  - Calibrate the flag thresholds to the MSP's blended cost/hour before acting.
*/
SELECT TOP 50
  ar.Aarea AS client_id,
  ar.aareadesc AS client,
  ROUND(ISNULL(rev.mrr, 0), 2) AS mrr,
  ROUND(lab.hours_delivered, 1) AS hours_delivered,
  ROUND(lab.charge_amount, 2) AS charge_amount,
  CASE WHEN rev.mrr > 0
       THEN ROUND(lab.hours_delivered / (rev.mrr / 100.0), 2)
       ELSE NULL END AS hours_per_100_mrr,
  CASE
    WHEN rev.mrr IS NULL OR rev.mrr = 0 THEN 'NO RECURRING REVENUE'
    WHEN lab.hours_delivered / (rev.mrr / 100.0) >= 5 THEN 'OVER-SERVICED'
    WHEN lab.hours_delivered / (rev.mrr / 100.0) >= 2 THEN 'WATCH'
    ELSE 'OK'
  END AS flag
FROM AREA ar
INNER JOIN (
  SELECT f.Areaint AS aid,
    SUM(a.timetaken) AS hours_delivered,
    SUM(a.ActionChargeAmount) AS charge_amount
  FROM ACTIONS a
  INNER JOIN FAULTS f ON f.Faultid = a.Faultid
  WHERE f.FDeleted = 0
    AND f.FMergedIntoFaultid = 0
    AND a.ActionDateCreated >= DATEADD(month, -3, GETDATE())  /* EDIT: window */
  GROUP BY f.Areaint
  HAVING SUM(a.timetaken) >= 2                                /* EDIT: min hours */
) lab ON lab.aid = ar.Aarea
LEFT JOIN (
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
ORDER BY hours_per_100_mrr DESC
