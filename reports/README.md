# HaloPSA analytical report library

A portable library of HaloPSA **Report Center** SQL reports for MSP oversight —
service-desk delivery, ticket categorisation, technician performance, and
client/billing/profitability. Every query was validated against a live HaloPSA
tenant before being committed.

These are MSP-agnostic: no hardcoded client/agent IDs. Anything you might want
to tune (date windows, horizons, TOP counts, the occasional tenant-specific
status/type ID) is marked `/* EDIT: ... */` in each file's header.

## How to use

- **In Halo:** Config → Report Center → new report → paste the SQL → Save/Run.
- **Programmatically:** pass the SQL to the `runSql` MCP tool (single statement
  per call). For the most common KPIs there are dedicated MCP tools — see
  *Composite MCP tools* below — which return parsed JSON instead of raw rows.

### Report Center SQL rules (why the queries look the way they do)

One statement per query · no `--` comments (use `/* */`) · no trailing semicolon ·
no variables/`DECLARE`/temp tables/CTEs-with-variables · British spellings in
string literals · `ORDER BY` requires `TOP`, `OFFSET`, or `FOR XML`. `runSql`
array-batching returns only the **last** statement's result, so each report is a
single statement.

> **`ORDER BY` tip:** to return a *full* ordered result set (no arbitrary cap),
> append `OFFSET 0 ROWS` instead of `TOP n` — it satisfies the parser rule and
> preserves order. Avoid `TOP 100 PERCENT ... ORDER BY`: the optimizer is allowed
> to drop the sort. Use `TOP n` only when you deliberately want the top N rows.

## ⚠️ Data-quality traps (read before trusting any number)

These were discovered the hard way mapping this schema; they hold across the
library and are the difference between a real number and a garbage one.

| Trap | Reality | Use instead |
| --- | --- | --- |
| **`datecreated`** | Row-metadata stamp; post-dates clearance on ~95% of tickets (negative durations). | `dateoccured` for the ticket-open time. |
| **`datecleared`** | **Reliable.** For real tickets it matches the actual close action to the minute. It only *looks* corrupt in aggregate because closed-on-creation stubs (see next row) make it equal `dateoccured`. Don't use `Flastactiondate` (contaminated by post-close automations/reopens/appointments) or the last-close-action `Whe_` (contaminated by hourly bot status-syncs). | `DATEDIFF(minute, dateoccured, datecleared)` for wall-clock MTTR. |
| **Closed-on-creation stubs** | "Quick Time" time-log tickets (and similar) are opened and closed in the same instant, so `datecleared == dateoccured`. They can be ~96% of the "reactive" set and drag every duration to zero. | Exclude from service-delivery metrics: keep only `datecleared > dateoccured OR still open`. Their *time* still counts via ACTIONS. |
| **`cleartime`** | Halo working-**days** SLA duration (different semantic), not wall-clock. | `DATEDIFF(minute, dateoccured, datecleared)`. |
| **Bit columns are NULL, not 0** | `uisapiagent`, `fdeleted`, `fmergedintofaultid` are often NULL; `x = 0` drops rows. | `COALESCE(x,0)`. Exclude bots via `COALESCE(u.uisapiagent,0)=0`. |
| **`faisatisfactionlevel` / `Slastate`** | Stored as **nvarchar** with non-numeric values ('O', etc.). | `TRY_CONVERT(float, …)` before maths. |
| **Open vs closed** | `TstatusType` is **not** a reliable open/closed flag (Resolved/Closed/Completed are all type 0). | Open = `datecleared` NULL/`<1900`; closed statuses are IDs `(8,9,20)` here `/* EDIT */`. |
| **Agent cost** | `UNAME.ucostPrice` is the per-hour cost rate; when cost-history tracking is on, `UnameCostTracking` (`uctCost`, date-ranged by `uctStartDate`/`uctEndDate`) holds the rate effective on the work date. Both are HOURLY in standard Halo — but a tenant may store an annual salary there, inflating labour cost. Coverage is partial. | `COALESCE(uct.uctCost, ucostPrice)` × hours; gate margin on a coverage %, and prefer **effectiveRate** (revenue ÷ hours) when coverage is low. Avoid `CF*` columns (per-tenant custom fields). |
| **Billable time** | Determined by the action's **charge code**, not `ActIsBillable` (over-counts) or `ActionChargeHours`/`ActionNonChargeHours` (≈empty in many tenants). Non-billable is stored as `ActionCode = -1`. | Billable = `timetaken` where `COALESCE(ActionCode,-1)+1 > 0`. Matches the `charge_hours` a timesheet day/range summary reports. |
| **Action work date** | `ActionDateCreated` can be backdated. | `COALESCE(Whe_, ActionArrivalDate, ActionDateCreated)` for when work was actually done. |
| **Booked working time** | Only **ticket-linked** appointments are client/working time; unlinked appointments are internal meetings. | `APPOINTMENT` where `APFaultid > 0` (exclude `APdeleted`/`APAllDayEvent`). Logged `ACTIONS` time often exceeds ticket-linked booked. |
| **Recognised revenue** | `ACTIONS.actioninvoicelineid → INVOICEDETAIL.IDid` (`IDNet_Amount`) is the UNIFIED recognition key — covers BOTH T&M and prepay deferred-revenue lines. Many actions fan out to one line. | `SUM(IDNet_Amount)` over **DISTINCT** line ids (per-action sum multiplies). Prepay-DR slice = `ACTIONS.adefprepayamount` (already inside the distinct-line sum — don't add on top). On DR tenants `actionprepayamount` is 0; use `adefprepayamount`. |
| **Prepay account (deferred revenue)** | CONTRACT-grain (`PREPAYHISTORY.PPContractID`). Cash collected = top-ups (`PPAmount`/`pphours`, invoiced); earned = `adefprepayamount`; hours drawn = `ActionPrePayHours`. `pphours` can be NEGATIVE (adjustments) so purchased is net; `PPAmount` is sometimes 0 (non-cash credit). | `getPrepayAccountBalance`. Remaining = purchased − consumed (negative = over-drawn); deferred = collected − recognised. A `$0`-collected contract with recognised revenue is usually the non-cash-credit artifact, not real uncollected revenue — don't roll up by client. |
| **Uncharged labour** | Billable time can be billed via prepay draw-down OR a direct charge, so delivered − prepayConsumed over-counts a "leak". | Genuine leak = billable hours with `ActionPrePayHours=0` AND `ActionChargeAmount=0`. |
| **Currency** | Amounts are in the home currency, not assumed `£`/`$`. | The `CURRENCY` row with `Crate = 1.0` (`Ccode`). |
| **Client active** | `AREA.aisinactive` (bit, often NULL). | `COALESCE(aisinactive,0)=0` = active; flag balances/work on inactive clients. |

**Halo schema idioms:** `FAULTS`=tickets · client=`AREA` (`area.aarea=faults.areaint`,
`aareadesc`=name) · agent=`UNAME` (`unum`=id, `uname`=name; `assignedtoint`/`clearwhoint`) ·
status=`TSTATUS` · type=`REQUESTTYPE` (reactive = `RTIsProject=0 AND RTIsOpportunity=0`) ·
notes/time=`ACTIONS` (`timetaken`=hours, `whoagentid`=tech) · revenue=`RecurringInvoices`
view · contracts=`CONTRACTHEADER` (`CHid`, `CHarea`=client) · prepaid=`PREPAYHISTORY`
(top-up ledger by `PPContractID`: `PPAmount` cash / `pphours` hours, both can be 0/negative) ·
home currency=`CURRENCY` row with `Crate=1.0` ·
assets=`DEVICE` · opportunities are `FAULTS` of the Opportunity request type · categories
= `category2` (denormalised `A>B>C` path); SLA state `'I'`=met / `'O'`=breached / `''`=none;
CSAT = `faisatisfactionlevel` (AI 1–10); reopen = ACTIONS status transition out of `(8,9,20)`;
reassignment = `ACTIONS.Actoutcome='Re-Assign'`. Audit trail = `AUDIT` (`AUnum`=editor,
`ADate`=when, `atablename`+`apkid1`/`apkid2` identify the changed row — for actions
`apkid1`=faultid, `apkid2`=actionnumber; filter the editor's `uisapiagent` to drop bots).

## Catalogue

### `service-desk/` — delivery & SLA
| Report | Answers |
| --- | --- |
| `ticket-throughput-monthly.sql` | Created vs resolved per month + net backlog change |
| `ticket-throughput-isoweek.sql` | Same, ISO-week buckets, for surge spotting |
| `backlog-aging-snapshot.sql` | Open tickets bucketed by age (via `dateoccured`) |
| `stale-open-tickets.sql` | Open tickets with no action in 7/14/30 days |
| `sla-attainment-by-priority.sql` | Resolution-SLA met/breached % by priority |
| `sla-attainment-by-client.sql` | SLA % met per client, worst-first |
| `sla-attainment-by-category.sql` | SLA % met per category, worst-first |
| `sla-attainment-monthly-trend.sql` | Monthly SLA-met % trend |
| `resolution-time-distribution.sql` | Wall-clock MTTR buckets (`dateoccured`→`Flastactiondate`) |
| `first-response-and-breaches.sql` | First-response time distribution + breach list |
| `reopen-rate.sql` | Monthly reopen rate via ACTIONS status transitions |
| `ticket-reassignment-bouncing.sql` | Per-ticket `Re-Assign` counts (routing/categorisation quality) |

### `categories/` — categorisation & problem management
| Report | Answers |
| --- | --- |
| `category-volume-and-time.sql` | Top categories by ticket volume and total logged hours |
| `recurring-problem-categories.sql` | Automation/KB candidates ranked by effort (tickets × hours) |
| `first-time-fix-by-category.sql` | First-time-fix % (never reopened nor reassigned) by category |
| `uncategorised-and-ai-mismatch.sql` | Monthly % uncategorised + AI-suggested vs actual mismatch |

### `technicians/` — performance, coaching & disengagement
| Report | Answers |
| --- | --- |
| `productivity-scorecard.sql` | Per-tech resolved, actions, hours, billable ratio, tickets touched |
| `quality-scorecard.sql` | Per-tech reopen %, SLA breach %, CSAT, median resolution |
| `coaching-time-outliers-by-category.sql` | Tech vs **team median** per category — knowledge-gap outliers |
| `quality-by-category-breach.sql` | Per-tech × category SLA breach % + reopens |
| `disengagement-signals.sql` | Resolved vs peer median, hours logged, untouched owned tickets, after-hours % |
| `time-entry-hygiene.sql` | % of closes with **zero time logged**; closed-with-no-notes |
| `time-entry-round-number-gaming.sql` | Share of time entries on round values (padding signal) |
| `time-entry-latency.sql` | Real-time logging discipline: lag between work date and entry, % logged within 1h, back-edits >1 day later |
| `time-entry-retroactive-edits.sql` | Audit-trail: which **real agents** modify time-carrying actions >1 day after creation (bots filtered via editor `uisapiagent`) |
| `utilisation-vs-target.sql` | Logged & billable hours vs configured target (REST `/Timesheet` for authoritative) |
| `monthly-throughput-trend.sql` | Per-tech monthly resolved/hours/touched (decline detector) |
| `after-hours-work-pattern.sql` | Business-hours vs after-hours action split (timezone caveat) |
| `workload-balance-open-age.sql` | Open tickets per tech with age buckets (hoarding signal) |

### `clients-billing/` — revenue, profitability & risk
| Report | Answers |
| --- | --- |
| `client-profitability.sql` | MRR vs delivered hours; effective £/hr, least-profitable first |
| `over-servicing-detection.sql` | Hours delivered per £100 MRR; over-serviced flags |
| `prepaid-hours-burndown.sql` | Purchased vs consumed prepaid hours; over-limit flags |
| `contract-expiry-tracker.sql` | Active contracts with term/end/status; expiry flags |
| `client-health-churn-risk.sql` | Volume trend, CSAT, SLA, recency → churn-risk flags |
| `revenue-concentration.sql` | Client share of MRR + cumulative % (dependency risk) |
| `mrr-breakdown-by-period.sql` | Recurring revenue by billing cadence |
| `asset-inventory-by-client-type.sql` | Active asset/CI counts per client and type |
| `asset-warranty-licence-expiry.sql` | Assets with warranty/licence expiry in a horizon |
| `opportunities-pipeline.sql` | Open pipeline count/value/weighted by stage |
| `opportunities-by-client.sql` | Open pipeline value per account |

## Composite MCP tools

For recurring KPIs the MCP server (`apps/mcp`) exposes parsed-JSON tools so an
AI assistant doesn't have to write SQL:

- **`getServiceDeskHealth`** — inflow/outflow, backlog, SLA attainment, MTTR, FTF, CSAT.
- **`getTechnicianScorecard`** — per-tech resolved, MTTR, SLA, CSAT, hours.
- **`getTechnicianRiskSignals`** — coaching-vs-disengagement flags (zero-time closes, SLA breach, stale backlog, low CSAT, late time-entry / real-time logging discipline).
- **`getClientHealthScorecard`** — per-client volume, SLA, MTTR, CSAT.
- **`getCategoryInsights`** — uncategorised %, top categories, recurring-problem candidates.
- **`getTicketBacklog`** — point-in-time aging + SLA-at-risk + oldest tickets.
- **`getRecurringProblemClusters` / `getDuplicateTickets` / `getClientDejaVu` / `getSimilarTicketInsights`** — ticket-similarity tools on the embedding graph (`FaultVectorScore`, `fvsSearchMethod=1 AND FVSuse=0` = ticket↔ticket).
- **`getKnowledgeGaps`** — KB coverage + most-matched articles + highest-effort uncovered tickets, from ticket↔KB embedding matches (`FVSuse=1`). Requires KB embeddings enabled in Halo.
- **`getTicketsToCategorize` / `setTicketCategory` / `createCategory` / `triggerTicketAiSummary`** — AI-in-the-loop categoriser: fetch the controlled taxonomy (CATEGORYDETAIL CDType=2) + scoped tickets with their AI summary (scope by uncategorised / specific category / time range), the model matches each summary to a category, then `setTicketCategory` writes the primary category (API `category_1`/`categoryid_1` = DB `category2`); `createCategory` (POST /Category, type_id 1) adds genuinely-missing categories; `triggerTicketAiSummary` (POST /Tickets `_re_index=true`) regenerates a ticket's AI summary (async — re-pull after a moment).
- **`getNoiseTicketAnalysis`** — quantifies low-value tickets (auto-replies, OOO, OTP, newsletters, tests), hours wasted, and a per-type source-fix recommendation + per-mailbox breakdown — to stop them at intake rather than categorise them forever.
- **`getProjectPortfolio` / `getProjectProfitability` / `getResourceForecast` / `getTechnicianUtilization` / `getPrepayAccountBalance`** — project, resourcing & billing oversight:
  - **`getProjectPortfolio`** — % complete via child tasks, rolled-up hours vs estimate, age. (Deadline/budget fields are empty in-tenant; use % complete + hours-vs-estimate as the at-risk signal.)
  - **`getProjectProfitability`** — `revenue` = RECOGNISED revenue from DISTINCT linked invoice lines (`actioninvoicelineid → INVOICEDETAIL.IDNet_Amount`, covers T&M + prepay-DR, deduped for fan-out), split into `prepayRecognised` + `tmRecognised`; delivered/billable hours; prepay purchased/consumed; `effectiveRate`; `unchargedHours` (billable billed by neither prepay nor charge); labour cost + coverage %; `overServiced` vs the purchased prepay block. Main project = `fmainprojectid` NULL/0/self; money links via `FAULTS.fcontractid`.
  - **`getResourceForecast`** — forward **ticket-linked** booked `APPOINTMENT` hours (internal meetings reported separately) vs a flat weekly capacity → over-allocated / bench.
  - **`getTechnicianUtilization`** — past-window booked (ticket-linked) vs worked (`timetaken`) vs billable (charge code) vs internal-meeting hours, against leave-adjusted capacity; flags meeting-heavy / below-target / low-billability.
  - **`getPrepayAccountBalance`** — per-contract deferred-revenue account: cash collected vs hours consumed / revenue recognised, `remainingHours` (negative = over-drawn), `deferredBalance`, `clientActive`, status (over-drawn / untouched / low-balance / healthy). Answers "negative prepay balance", "untouched prepay", "deferred left to recognise".

Plus financial tools already in the server: `getMrrSnapshot`, `getMspKpis`,
`getRevenuePerTechSnapshot`, `getMrrPerSeatSnapshot`, `getTechnicianUtilizationSnapshot`.

> Note: the composite ticket KPIs (`getServiceDeskHealth` / `getTechnicianScorecard`
> / `getClientHealthScorecard` / `getCategoryInsights` / `getTechnicianRiskSignals`)
> compute MTTR from `dateoccured`→`datecleared` and exclude closed-on-creation stubs
> (`datecleared > dateoccured OR still open`), so they reflect real serviced tickets.
> Some `.sql` files in `service-desk/` predate this finding and may still use
> `Flastactiondate` or count Quick Time stubs — prefer `datecleared` + the stub
> filter when adapting them.
