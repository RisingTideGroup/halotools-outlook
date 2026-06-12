/*
TITLE: Client Health & Churn-Risk Scorecard
WHAT IT ANSWERS: Per client composite of leading churn indicators over a trailing
  window: ticket-volume trend (recent vs prior half), average CSAT, SLA breaches,
  recency of last activity. Surfaces accounts that look at-risk.
KEY COLUMNS: client, mrr, tickets_180d, tickets_recent_90d, tickets_prior_90d,
  ticket_trend, avg_csat, sla_breaches, days_since_last_ticket, risk_flags
PARAMS:
  - Window: 180 days, split into recent/prior 90-day halves. /* EDIT: DATEADD windows */
  - TOP 60 ordered by mrr descending (protect the biggest first). /* EDIT: TOP n / ORDER */
NOTES:
  - dateoccured is the ticket-open time (datecreated is corrupt — do not use it).
  - faisatisfactionlevel is the populated CSAT (nvarchar, 0-10 scale; most tickets
    unscored). It can contain non-numeric junk, so it is read via TRY_CONVERT(float,...);
    avg_csat is over scored tickets only. Lower = unhappier.
  - Slastate is nvarchar and can hold non-numeric values; compared via TRY_CONVERT(int,...).
    The breach state code (assumed 3) is TENANT-CONFIGURABLE — confirm your tenant's
    SLA state enum before trusting sla_breaches; it read 0 across the board in the
    source tenant, which may mean a different code is used.
  - ticket_trend = recent_90d - prior_90d. A large NEGATIVE value = activity falling off
    (possible disengagement/offboarding); a large POSITIVE value = escalating demand.
  - mrr is LEFT-joined so non-recurring clients still appear (mrr NULL/0).
  - risk_flags concatenates the heuristics that tripped; tune thresholds per MSP.
*/
SELECT TOP 60
  h.client_id,
  h.client,
  ROUND(ISNULL(r.mrr, 0), 2) AS mrr,
  h.tickets_180d,
  h.tickets_recent_90d,
  h.tickets_prior_90d,
  (h.tickets_recent_90d - h.tickets_prior_90d) AS ticket_trend,
  h.avg_csat,
  h.sla_breaches,
  DATEDIFF(day, h.last_ticket, GETDATE()) AS days_since_last_ticket,
  LTRIM(
    CASE WHEN h.tickets_prior_90d > 0
              AND h.tickets_recent_90d * 1.0 / h.tickets_prior_90d < 0.5
         THEN ' activity-down>50%' ELSE '' END
  + CASE WHEN h.avg_csat IS NOT NULL AND h.avg_csat < 5 THEN ' low-csat' ELSE '' END
  + CASE WHEN h.sla_breaches > 0 THEN ' sla-breaches' ELSE '' END
  + CASE WHEN DATEDIFF(day, h.last_ticket, GETDATE()) > 45 THEN ' quiet>45d' ELSE '' END
  ) AS risk_flags
FROM (
  SELECT f.Areaint AS client_id, ar.aareadesc AS client,
    COUNT(*) AS tickets_180d,
    SUM(CASE WHEN f.dateoccured >= DATEADD(day, -90, GETDATE()) THEN 1 ELSE 0 END) AS tickets_recent_90d,
    SUM(CASE WHEN f.dateoccured <  DATEADD(day, -90, GETDATE()) THEN 1 ELSE 0 END) AS tickets_prior_90d,
    MAX(f.dateoccured) AS last_ticket,
    ROUND(AVG(TRY_CONVERT(float, f.faisatisfactionlevel)), 2) AS avg_csat,
    SUM(CASE WHEN TRY_CONVERT(int, f.Slastate) = 3 THEN 1 ELSE 0 END) AS sla_breaches  /* EDIT: breach state code */
  FROM FAULTS f
  INNER JOIN AREA ar ON ar.Aarea = f.Areaint
  WHERE f.FDeleted = 0
    AND f.FMergedIntoFaultid = 0
    AND f.dateoccured >= DATEADD(day, -180, GETDATE())   /* EDIT: window */
  GROUP BY f.Areaint, ar.aareadesc
) h
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
) r ON r.cid = h.client_id
ORDER BY mrr DESC
