/*
TITLE: Revenue Concentration — Client Dependency Risk
WHAT IT ANSWERS: Ranks clients by share of total MRR and shows the running cumulative
  percentage, so you can see how few clients make up the bulk of recurring revenue
  (the 80/20 / customer-concentration risk).
KEY COLUMNS: client, mrr, pct_of_mrr, cumulative_pct, rank
PARAMS:
  - TOP 30 by MRR descending.  /* EDIT: TOP n — raise to see the full book */
NOTES:
  - Run this to answer "what % of revenue rides on our biggest client?" and "how many
    clients make up 80% of MRR?" (read the first row where cumulative_pct >= 80).
  - cumulative_pct uses SUM(...) OVER (ORDER BY mrr DESC); ties share the same running
    total. pct_of_mrr is the client's individual share of the whole recurring book.
  - MRR normalisation and the RecurringInvoices view caveats match the other reports.
  - High first-row pct_of_mrr (e.g. one client > 30-40%) is a material concentration
    risk worth flagging to ownership.
*/
SELECT TOP 30
  client_id,
  client,
  ROUND(mrr, 2) AS mrr,
  ROUND(mrr * 100.0 / SUM(mrr) OVER (), 2) AS pct_of_mrr,
  ROUND(SUM(mrr) OVER (ORDER BY mrr DESC ROWS UNBOUNDED PRECEDING) * 100.0
        / SUM(mrr) OVER (), 2) AS cumulative_pct,
  ROW_NUMBER() OVER (ORDER BY mrr DESC) AS rank
FROM (
  SELECT ar.Aarea AS client_id, ar.aareadesc AS client,
    SUM(CASE ri.[Period]
          WHEN 'Monthly'     THEN ri.[Net Price]
          WHEN 'Yearly'      THEN ri.[Net Price] / 12.0
          WHEN 'Quarterly'   THEN ri.[Net Price] / 3.0
          WHEN 'Weekly'      THEN ri.[Net Price] * 52.0 / 12.0
          WHEN 'Half-Yearly' THEN ri.[Net Price] / 6.0
          WHEN 'Two-Yearly'  THEN ri.[Net Price] / 24.0
          ELSE ri.[Net Price]
        END) AS mrr
  FROM RecurringInvoices ri
  INNER JOIN AREA ar ON ar.Aarea = ri.[Customer ID]
  GROUP BY ar.Aarea, ar.aareadesc
) t
ORDER BY mrr DESC
