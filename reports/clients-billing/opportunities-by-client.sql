/*
TITLE: Open Opportunities by Client
WHAT IT ANSWERS: Open pipeline value per client/prospect — who has the biggest open
  deals, their probability-weighted value and recurring component. Cross-sell/upsell
  and forecast view at the account level.
KEY COLUMNS: client, opp_count, total_value, weighted_value, monthly_recurring_value,
  max_single_deal, latest_opp_opened
PARAMS:
  - Open only: datecleared IS NULL.  /* EDIT: include closed for win-rate analysis */
  - Opportunity ticket type id = 6.   /* EDIT: RequestTypeNew */
  - TOP 50 ordered by weighted_value descending.  /* EDIT: TOP n / ORDER BY */
NOTES:
  - Opportunities are FAULTS of the Opportunity request type (see opportunities-pipeline.sql).
  - Client is taken from FAULTS.Areaint (the linked account). For brand-new prospects with
    no AREA record the opp may carry FOppCompanyName instead; those rows show NULL client
    here. Swap to COALESCE(ar.aareadesc, f.FOppCompanyName) if you want prospect names too.
  - weighted_value = SUM(FOppValue * FOppConversionProbability/100).
  - Excludes deleted/merged tickets.
*/
SELECT TOP 50
  f.Areaint AS client_id,
  ar.aareadesc AS client,
  COUNT(*) AS opp_count,
  ROUND(SUM(f.FOppValue), 2) AS total_value,
  ROUND(SUM(f.FOppValue * f.FOppConversionProbability / 100.0), 2) AS weighted_value,
  ROUND(SUM(f.foppvaluemonthly), 2) AS monthly_recurring_value,
  ROUND(MAX(f.FOppValue), 2) AS max_single_deal,
  MAX(f.dateoccured) AS latest_opp_opened
FROM FAULTS f
LEFT JOIN AREA ar ON ar.Aarea = f.Areaint
WHERE f.FDeleted = 0
  AND f.FMergedIntoFaultid = 0
  AND f.RequestTypeNew = 6        /* EDIT: Opportunity request-type id */
  AND f.datecleared IS NULL       /* EDIT: open opportunities only */
GROUP BY f.Areaint, ar.aareadesc
ORDER BY weighted_value DESC
