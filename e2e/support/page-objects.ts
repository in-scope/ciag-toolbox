// Single entry point for the E2E page objects and shared readbacks, so specs read
// like the manual test script (loadFixtureAsStack, selectPanel, openOperation,
// readPixelValueAt, readMetadata, readHistoryEntries, readRegionStats).

export { loadFixtureAsStack } from "./load-fixture";
export {
  panelGrid,
  panelCell,
  panelCanvas,
  selectPanel,
  countSelectedPanels,
  countPanels,
} from "./panels";
export {
  applicationToolbar,
  operationPanel,
  openOperation,
  applyOperation,
  cancelOperation,
  isApplyEnabled,
} from "./operations";
export {
  statusBar,
  hoverImagePixel,
  readPixelReadout,
  readPixelValueAt,
  type PixelReadout,
} from "./pixel-readout";
export { metadataSection, readMetadata, type MetadataReadout } from "./metadata-panel";
export {
  historySection,
  historyList,
  historyEntryCount,
  readHistoryEntries,
  type HistoryEntryReadout,
} from "./history-panel";
export {
  regionSection,
  readRegionStats,
  histogramSection,
  histogramCanvas,
  readHistogramActiveBandLabel,
  type RegionStatsReadout,
} from "./stats-panels";
export {
  computeCanvasPointForImagePixelAtFitView,
  type PixelDimensions,
  type CanvasPoint,
} from "./image-pixel-canvas-mapping";
export {
  expectPixelReadoutToEqual,
  expectHistoryToRecordOperation,
  expectMetadataDataTypeAndDimensions,
  type ExpectedPixelValue,
  type ExpectedHistoryEntry,
  type ExpectedMetadata,
} from "./assertions";
export {
  regionToolButton,
  activateRegionTool,
  ensureRegionToolInactive,
  panelCanvasCenter,
  pagePointForImagePixelCenter,
  pixelsPerImagePixelVertically,
  dragMouseFromTo,
  drawInspectionRoiBetweenPixels,
  readCommittedRoiOverlayRect,
  wheelAtPagePoint,
  readReadoutAtPagePoint,
  resetViewWithDoubleClick,
  type ImagePixel,
  type CanvasRect,
} from "./viewport-navigation";
