# Outlook add-in UX audit (Sep 2026)

Design-canvas source for the findings-only audit of the Outlook add-in.
Published canvas (verified findings + current vs proposed mockups):
https://claude.ai/code/artifact/ad7b4aa5-b6f5-4edc-94cc-0e6b3c5da69f

Each `*.dc.html` is one artboard; `canvas.json` lays them out and holds the
annotation text. Pairs:

1. `DashboardCurrent` / `Main` — read-pane dashboard
2. `PickerCurrent` / `PickerProposed` — append-to-ticket picker
3. `HaloActionCurrent` / `HaloActionProposed` — how a logged email renders in Halo
4. `ComposeCurrent` / `ComposeProposed` — compose pane

Key verified finding: `/Tickets` and `/Opportunities` are the same endpoint;
the add-in never passes `domain`, so it runs in `domain=reqs` mode and
opportunities are excluded. `domain=all` on the existing calls is the fix.

The seeded ~2.5 MB canvas page is a build output and is not committed.
