/*
TITLE: Uncategorisation Rate + AI-Suggested vs Actual Category Mismatch
WHAT IT ANSWERS: Two data-hygiene signals in one monthly rollup for reactive tickets:
   (1) what % of tickets are left UNCATEGORISED (blank category2); and
   (2) of the tickets where the AI suggested a category (faisuggestedcategory),
       how often the agent's actual category2 disagrees with it (mismatch rate).
KEY COLUMNS: ym, tickets, uncategorised, pct_uncategorised,
  ai_suggested, ai_mismatch, ai_mismatch_pct
PARAMS:
  /* EDIT: window start */ '2025-01-01' on dateoccured.
NOTES:
  - In this tenant category2 is ~97% blank on reactive tickets, so the
    uncategorised % is the headline number the owner asked about.
  - faisuggestedcategory is populated on only a minority of tickets; the mismatch
    rate is computed ONLY over tickets that have BOTH an AI suggestion and a
    non-blank actual category (so a blank actual doesn't count as a "mismatch").
  - Comparison is a trimmed case-insensitive string compare; AI text and category2
    may differ in hierarchy depth so treat the mismatch % as directional.
*/
SELECT
  FORMAT(f.dateoccured, 'yyyy-MM') AS ym,
  COUNT(*) AS tickets,
  SUM(CASE WHEN LTRIM(RTRIM(ISNULL(f.category2,''))) = '' THEN 1 ELSE 0 END) AS uncategorised,
  CAST(100.0 * SUM(CASE WHEN LTRIM(RTRIM(ISNULL(f.category2,''))) = '' THEN 1 ELSE 0 END)
       / NULLIF(COUNT(*),0) AS decimal(5,1)) AS pct_uncategorised,
  SUM(CASE WHEN LTRIM(RTRIM(ISNULL(f.faisuggestedcategory,''))) <> '' THEN 1 ELSE 0 END) AS ai_suggested,
  SUM(CASE WHEN LTRIM(RTRIM(ISNULL(f.faisuggestedcategory,''))) <> ''
            AND LTRIM(RTRIM(ISNULL(f.category2,''))) <> ''
            AND LOWER(LTRIM(RTRIM(f.faisuggestedcategory))) <> LOWER(LTRIM(RTRIM(f.category2)))
           THEN 1 ELSE 0 END) AS ai_mismatch,
  CAST(100.0 * SUM(CASE WHEN LTRIM(RTRIM(ISNULL(f.faisuggestedcategory,''))) <> ''
            AND LTRIM(RTRIM(ISNULL(f.category2,''))) <> ''
            AND LOWER(LTRIM(RTRIM(f.faisuggestedcategory))) <> LOWER(LTRIM(RTRIM(f.category2)))
           THEN 1 ELSE 0 END)
       / NULLIF(SUM(CASE WHEN LTRIM(RTRIM(ISNULL(f.faisuggestedcategory,''))) <> ''
            AND LTRIM(RTRIM(ISNULL(f.category2,''))) <> '' THEN 1 ELSE 0 END),0) AS decimal(5,1)) AS ai_mismatch_pct
FROM FAULTS f
JOIN REQUESTTYPE rt ON rt.RTid = f.requesttypenew
WHERE f.fdeleted = f.fmergedintofaultid
  AND rt.RTIsProject = 0 AND rt.RTIsOpportunity = 0
  AND f.dateoccured >= '2025-01-01'  /* EDIT: window start */
GROUP BY FORMAT(f.dateoccured, 'yyyy-MM')
