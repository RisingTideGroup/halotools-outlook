/*
TITLE: Asset (CI) Inventory — Counts by Client and Type
WHAT IT ANSWERS: How many active configuration items / assets each client has, broken
  down by asset type. Useful for per-seat/per-device billing reconciliation and for
  spotting clients whose managed estate has drifted from what they pay for.
KEY COLUMNS: client, type_id, asset_count
PARAMS:
  - Active assets only (dinactive = 0).  /* EDIT: remove to include retired assets */
  - TOP 100 ordered by client then count.  /* EDIT: TOP n */
NOTES:
  - Assets/CIs live in the DEVICE table. darea = AREA.Aarea (owning client),
    Dtype = asset-type id, dinactive = retired flag, Dsite = location within client.
  - type_id is the raw Halo asset-type key. The human-readable type name is held in a
    tenant-specific type lookup that was not cleanly resolvable in the source tenant;
    map the ids in Halo (Configuration > Asset Types) or join your tenant's type table
    if identified. Common ids in the source tenant: 136-139.
  - For a single grand-total per client (no type split), remove Dtype from SELECT/GROUP BY.
  - This is a sandbox-sparse area in the source tenant (low counts); the shape scales.
*/
SELECT TOP 100
  d.darea AS client_id,
  ar.aareadesc AS client,
  d.Dtype AS type_id,
  COUNT(*) AS asset_count
FROM DEVICE d
INNER JOIN AREA ar ON ar.Aarea = d.darea
WHERE d.dinactive = 0
GROUP BY d.darea, ar.aareadesc, d.Dtype
ORDER BY client, asset_count DESC
