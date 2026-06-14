/*
TITLE: MRR Breakdown by Billing Period
WHAT IT ANSWERS: Total recurring revenue split by billing cadence (Monthly, Yearly,
  Quarterly, ...). Shows how much actually bills each period vs the monthly-normalised
  MRR contribution, plus how many clients/lines sit on each cadence.
KEY COLUMNS: period, clients, lines, billed_per_period, mrr_contribution, pct_of_mrr
PARAMS: none (whole active recurring book). /* EDIT: add WHERE on [Item Group] to scope */
NOTES:
  - Source is Halo's RecurringInvoices view (active lines only; disabled excluded).
  - billed_per_period = raw [Net Price] sum at that cadence (what hits the invoice run).
  - mrr_contribution = that cadence normalised to a monthly figure; summing this column
    across all rows gives total company MRR.
  - A blank Period row exists in this tenant (lines with no cadence set); treated as
    monthly in the normalisation. Investigate/clean those lines in Halo.
  - There is no historical snapshot table, so a true MRR time-series/trend cannot be
    built from SQL alone — this view reflects the CURRENT recurring book only. For
    period-over-period trend, snapshot mrr_contribution on a schedule, or use the
    getMrrSnapshot MCP tool.
*/
SELECT
  CASE WHEN [Period] = '' OR [Period] IS NULL THEN '(unset)' ELSE [Period] END AS period,
  COUNT(DISTINCT [Customer ID]) AS clients,
  COUNT(*) AS lines,
  ROUND(SUM([Net Price]), 2) AS billed_per_period,
  ROUND(SUM(CASE [Period]
          WHEN 'Monthly'     THEN [Net Price]
          WHEN 'Yearly'      THEN [Net Price] / 12.0
          WHEN 'Quarterly'   THEN [Net Price] / 3.0
          WHEN 'Weekly'      THEN [Net Price] * 52.0 / 12.0
          WHEN 'Half-Yearly' THEN [Net Price] / 6.0
          WHEN 'Two-Yearly'  THEN [Net Price] / 24.0
          ELSE [Net Price]
        END), 2) AS mrr_contribution,
  ROUND(SUM(CASE [Period]
          WHEN 'Monthly'     THEN [Net Price]
          WHEN 'Yearly'      THEN [Net Price] / 12.0
          WHEN 'Quarterly'   THEN [Net Price] / 3.0
          WHEN 'Weekly'      THEN [Net Price] * 52.0 / 12.0
          WHEN 'Half-Yearly' THEN [Net Price] / 6.0
          WHEN 'Two-Yearly'  THEN [Net Price] / 24.0
          ELSE [Net Price]
        END) * 100.0
    / SUM(SUM(CASE [Period]
          WHEN 'Monthly'     THEN [Net Price]
          WHEN 'Yearly'      THEN [Net Price] / 12.0
          WHEN 'Quarterly'   THEN [Net Price] / 3.0
          WHEN 'Weekly'      THEN [Net Price] * 52.0 / 12.0
          WHEN 'Half-Yearly' THEN [Net Price] / 6.0
          WHEN 'Two-Yearly'  THEN [Net Price] / 24.0
          ELSE [Net Price]
        END)) OVER (), 2) AS pct_of_mrr
FROM RecurringInvoices
GROUP BY [Period]
