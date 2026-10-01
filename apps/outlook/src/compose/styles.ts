import { makeStyles, shorthands, tokens } from "@fluentui/react-components";

/**
 * Shared Griffel styles for the compose task pane. One hook so the header,
 * Log-on-send card and insert tools stay visually consistent in a 320px pane.
 */
export const useComposeStyles = makeStyles({
  // ---------- shell ----------
  root: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground1,
    overflowY: "auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  brand: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    whiteSpace: "nowrap",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "12px",
    flex: 1,
  },
  centerPad: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "24px",
  },

  // ---------- header chips (timer / charge rate) ----------
  chip: {
    minWidth: 0,
    height: "24px",
    paddingLeft: "8px",
    paddingRight: "8px",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightRegular,
  },
  chipText: {
    minWidth: 0,
    maxWidth: "120px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  timerChip: {
    fontFamily: tokens.fontFamilyMonospace,
    fontWeight: tokens.fontWeightSemibold,
  },
  timerChipCapped: {
    color: tokens.colorPaletteYellowForeground1,
    ...shorthands.borderColor(tokens.colorPaletteYellowBorder1),
    backgroundColor: tokens.colorPaletteYellowBackground1,
    ":hover": {
      color: tokens.colorPaletteYellowForeground1,
      backgroundColor: tokens.colorPaletteYellowBackground2,
    },
  },
  popoverSurface: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    width: "240px",
    padding: "12px",
  },
  popoverActions: {
    display: "flex",
    justifyContent: "flex-start",
  },

  // ---------- Log on send card ----------
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "10px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  cardLabelRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: "24px",
  },
  cardLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  },
  stagedBanner: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 8px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorPaletteGreenBackground1,
    border: `1px solid ${tokens.colorPaletteGreenBorder1}`,
    color: tokens.colorPaletteGreenForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  stagedBannerText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  logButtonsRow: {
    display: "flex",
    gap: "8px",
  },
  logButtonFull: {
    flex: 1,
    minWidth: 0,
  },
  hint: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
  },

  // ---------- recipients (inside the card) ----------
  recipientList: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  recipientRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    minHeight: "24px",
  },
  recipientText: {
    flex: 1,
    minWidth: 0,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  recipientName: {
    fontWeight: tokens.fontWeightSemibold,
  },
  recipientSecondary: {
    color: tokens.colorNeutralForeground3,
  },
  moreButton: {
    alignSelf: "flex-start",
  },
  empty: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
  },

  // ---------- insert tools ----------
  tools: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  tabPanel: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  searchRow: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
  },
  groupSelect: {
    flexShrink: 0,
    maxWidth: "120px",
  },
  saveButton: {
    alignSelf: "flex-start",
  },
  resultList: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    maxHeight: "200px",
    overflowY: "auto",
  },
  resultRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 10px",
    cursor: "pointer",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground2Hover,
    },
    ":last-child": {
      borderBottom: "none",
    },
  },
  resultRowMain: {
    flex: 1,
    minWidth: 0,
  },
  resultPrimary: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  resultSecondary: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
  },
  resultPreview: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  insertAffordance: {
    flexShrink: 0,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorBrandForegroundLink,
  },
  toast: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    color: tokens.colorPaletteGreenForeground1,
    fontSize: tokens.fontSizeBase200,
  },
});
