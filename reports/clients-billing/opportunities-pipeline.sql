/*
TITLE: Sales Pipeline — Opportunity Value by Stage
WHAT IT ANSWERS: Open sales pipeline summarised by pipeline stage: number of
  opportunities, raw value, probability-weighted value, and recurring (monthly) value.
  Gives ownership the forward revenue picture.
KEY COLUMNS: pipeline_stage, opp_count, total_value, weighted_value,
  monthly_recurring_value, annual_value, oneoff_value
PARAMS:
  - Open only: datecleared IS NULL.  /* EDIT: remove to include won/lost/closed opps */
  - Opportunity ticket type id = 6.   /* EDIT: RequestTypeNew — confirm your tenant's
    Opportunity request-type id; 6 in the source tenant */
NOTES:
  - Opportunities are NOT a separate table — they are FAULTS (tickets) of the
    Opportunity request type. Opp fields live on FAULTS: FOppValue (deal value),
    FOppConversionProbability (0-100), fpipelinestage (stage id), foppvaluemonthly /
    foppvalueannual / foppvalueoneoff (revenue split), FOppConvertedDate (won date).
  - weighted_value = SUM(FOppValue * probability/100) — the expected/forecast number.
  - fpipelinestage is a stage id; the stage NAME lives in the tenant's pipeline config
    (map in Halo: Sales > Pipelines). A blank stage means unset.
  - Excludes deleted/merged. Add a dateoccured floor to scope to a period if desired.
  - Cross-check against the REST /Opportunities endpoint, which returns the same records
    with resolved client_name / pipeline_stage_id and is handy for drill-down.
*/
SELECT
  f.fpipelinestage AS pipeline_stage,
  COUNT(*) AS opp_count,
  ROUND(SUM(f.FOppValue), 2) AS total_value,
  ROUND(SUM(f.FOppValue * f.FOppConversionProbability / 100.0), 2) AS weighted_value,
  ROUND(SUM(f.foppvaluemonthly), 2) AS monthly_recurring_value,
  ROUND(SUM(f.foppvalueannual), 2) AS annual_value,
  ROUND(SUM(f.foppvalueoneoff), 2) AS oneoff_value
FROM FAULTS f
WHERE f.FDeleted = 0
  AND f.FMergedIntoFaultid = 0
  AND f.RequestTypeNew = 6        /* EDIT: Opportunity request-type id */
  AND f.datecleared IS NULL       /* EDIT: open opportunities only */
GROUP BY f.fpipelinestage
