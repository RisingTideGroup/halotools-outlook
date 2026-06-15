# Drill-down enrichment plan — make snapshot tools self-sufficient

**Goal:** every analytics tool returns (a) the headline KPI(s), (b) the **raw
underlying rows** that compose them, and (c) a `presentation` instruction that
tells Claude how to dashboard/chart the data **and** that it already holds the
rows — so follow-up questions are answered from context, not a fresh `runSql`
(which would force Claude to relearn the query each time).

## The contract (applied to every analytics result)

THREE legs — all required. The third is the one that actually gets the tool
*used*: an agent selects a tool from its **description**, before any call, so
enriching only the result payload is invisible if the description doesn't
advertise the drill dimensions (observed: agent skipped getMrrSnapshot and
hand-rolled listRecurringInvoices because the description didn't mention
per-client data).

1. **Description advertises the drill dimensions** — name `byClient` /
   `seatsByClient` / etc. and the questions it answers, and steer away from
   hand-rolling the raw list tools. THIS drives selection.
2. **Result carries the raw rows** that compose the KPI (top-N + `others` for
   unbounded dimensions; full list when bounded).
3. **`presentation` string** in the result: how to render + which follow-ups the
   embedded rows already answer (so no relearned runSql).

```ts
presentation: string  // concise: how to render + what follow-ups the embedded rows already answer
```

Rules:
- Lead the render with the headline KPIs, then the breakdown as a markdown
  table (sorted, with %-of-total / flags where useful); suggest a chart shape
  the user can ask for (bar/trend) — the connector renders markdown, not live
  widgets.
- Always include the **rows** that drive the KPI (top-N + an `others` roll-up
  for unbounded dimensions; full list when bounded).
- The `presentation` text must name the follow-ups answerable from the rows
  ("top clients, concentration, a given client's contracts — answer from the
  embedded rows; runSql only for detail beyond these fields").

## Inventory & status

Legend: ✅ done · 🔭 blind (needs breakdown rows added) · 📊 has rows (add `presentation`) · ⏭️ raw/operational (no change)

### Blind aggregates — add breakdown rows + presentation
- [x] 🔭 `getMrrSnapshot` — added `byClient[]` (client, contracts, monthlyRevenue, %) + `topClientPct` + presentation
- [x] 🔭 `getRevenuePerTechSnapshot` — added agent roster + mrrByClient; presentation clarifies it's a capacity ratio
- [x] 🔭 `getMrrPerSeatSnapshot` — added `seatsByClient[]` + presentation
- [x] 🔭 `getMspKpis` — added `mrrByClient` (top 25) + presentation
- [ ] 🔭 `getServiceDeskHealth` — add breakdowns (by day/category) + sample at-risk tickets

### Has rows — add presentation only
- [ ] 📊 `getTechnicianUtilizationSnapshot`
- [ ] 📊 `getTechnicianScorecard`
- [ ] 📊 `getClientHealthScorecard`
- [ ] 📊 `getTicketBacklog`
- [ ] 📊 `getCategoryInsights`
- [ ] 📊 `getTechnicianRiskSignals`
- [ ] 📊 `getRecurringProblemClusters`
- [ ] 📊 `getDuplicateTickets`
- [ ] 📊 `getClientDejaVu`
- [ ] 📊 `getSimilarTicketInsights`
- [ ] 📊 `getKnowledgeGaps`
- [ ] 📊 `getNoiseTicketAnalysis`
- [ ] 📊 `getProjectPortfolio`
- [ ] 📊 `getProjectProfitability`
- [ ] 📊 `getResourceForecast`
- [ ] 📊 `getTechnicianUtilization`
- [ ] 📊 `getPrepayAccountBalance`

### No change (raw lists / writes / escape hatches)
- ⏭️ findContact, listOpenTickets, searchTickets, getActivityFeed, listReports,
  listRecurringInvoices, listTimesheets, listContracts, listOpportunities,
  getTicketsToCategorize, runSql, haloApiRaw, createTicket, appendActionToTicket,
  logNote, searchCannedText, setTicketCategory, createCategory, triggerTicketAiSummary
