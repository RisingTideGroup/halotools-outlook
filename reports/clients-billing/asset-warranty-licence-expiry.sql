/*
TITLE: Asset Warranty & Licence Expiry — Upcoming
WHAT IT ANSWERS: Lists active assets whose warranty or supplier/licence term expires
  within a horizon, so renewals and hardware refreshes can be planned and quoted.
KEY COLUMNS: client, asset_id, asset_name, type_id, warranty_end, licence_supplier_end,
  days_to_warranty_end, days_to_licence_end, soonest_expiry
PARAMS:
  - Horizon: next 120 days.  /* EDIT: DATEADD(day,120,...) in the WHERE */
  - TOP 200 ordered by soonest expiry ascending.  /* EDIT: TOP n */
NOTES:
  - DEVICE.DWarrantyEndDate = hardware warranty end. DSupplierExpiryDate = the supplier
    contract / licence / subscription expiry the asset is tied to (often used for
    software-licence or vendor-support expiry). DLabourWarrantyEndDate also exists for
    labour-only warranty if needed.
  - Only active assets (dinactive = 0) with at least one of the two dates falling in the
    horizon are returned. Many assets carry no expiry dates (NULL) and are excluded.
  - darea = AREA.Aarea. Dtext is the asset's display name/label.
  - Dates of 1900-01-01 / NULL are treated as "no expiry" via the > GETDATE() guards.
*/
SELECT TOP 200
  d.darea AS client_id,
  ar.aareadesc AS client,
  d.Did AS asset_id,
  d.Dtext AS asset_name,
  d.Dtype AS type_id,
  d.DWarrantyEndDate AS warranty_end,
  d.DSupplierExpiryDate AS licence_supplier_end,
  CASE WHEN d.DWarrantyEndDate > GETDATE()
       THEN DATEDIFF(day, GETDATE(), d.DWarrantyEndDate) END AS days_to_warranty_end,
  CASE WHEN d.DSupplierExpiryDate > GETDATE()
       THEN DATEDIFF(day, GETDATE(), d.DSupplierExpiryDate) END AS days_to_licence_end,
  CASE
    WHEN d.DWarrantyEndDate > GETDATE() AND d.DSupplierExpiryDate > GETDATE()
      THEN CASE WHEN d.DWarrantyEndDate < d.DSupplierExpiryDate
                THEN d.DWarrantyEndDate ELSE d.DSupplierExpiryDate END
    WHEN d.DWarrantyEndDate > GETDATE() THEN d.DWarrantyEndDate
    ELSE d.DSupplierExpiryDate
  END AS soonest_expiry
FROM DEVICE d
INNER JOIN AREA ar ON ar.Aarea = d.darea
WHERE d.dinactive = 0
  AND (
        (d.DWarrantyEndDate   > GETDATE() AND d.DWarrantyEndDate   <= DATEADD(day, 120, GETDATE()))  /* EDIT: horizon */
     OR (d.DSupplierExpiryDate > GETDATE() AND d.DSupplierExpiryDate <= DATEADD(day, 120, GETDATE()))
      )
ORDER BY soonest_expiry ASC
