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
  clickPanelToSelect,
  expectPanelShowsSelectionRing,
  expectOnlyPanelsSelected,
  clickGridBackgroundToClearSelection,
  type PanelSelectionClickModifiers,
} from "./panels";
export {
  applicationToolbar,
  operationPanel,
  openOperation,
  applyOperation,
  applyOperationInPlace,
  setOpenInNewPanel,
  openInNewPanelSwitch,
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
  gridLayoutDropdownTrigger,
  gridLayoutOptions,
  openGridLayoutDropdown,
  readOfferedGridLayoutLabels,
  selectGridLayout,
  panelCloseButton,
  expectPanelHoldsFile,
  expectPanelIsEmpty,
  closedPanelsToast,
} from "./grid-layout-controls";
export {
  openPanelContextMenu,
  duplicateMenuItem,
  duplicatePanelViaContextMenu,
  duplicateReplacePicker,
  chooseReplaceTargetPanel,
  confirmReplaceWithChosenTarget,
  cancelReplacePicker,
} from "./duplicate-panel";
export {
  normalizedViewingToggle,
  toggleNormalizedViewing,
  expectNormalizedViewingEnabled,
} from "./normalized-viewing";
export { goToBandNumberInput, selectActiveBandNumber } from "./band-navigator";
export {
  removeBandButton,
  removeDisplayedBand,
  subsetBandsToggleButton,
  subsetBandsEditor,
  openSubsetBandsEditor,
  subsetBandsKeepCheckboxes,
  uncheckSubsetBandRow,
  setSubsetBandsOpenInNewPanel,
  applySubsetBands,
} from "./band-management";
export {
  spectraPlot,
  spectrumLinePaths,
  liveHoverSpectrumLine,
  pinnedSpectrumLines,
  expectLiveHoverSpectrumVisible,
  expectNoLiveHoverSpectrum,
  expectPinnedSpectrumLineCount,
  pinPixelSpectrum,
  expectSpectrumLineSubpathCount,
} from "./spectra-plot";
export {
  enqueueAndTriggerOpenImages,
  openImagesReviewModal,
  openImagesReplaceTargetPicker,
  reviewModalRows,
  readReviewModalRowFileNamesInOrder,
  confirmReviewModal,
  cancelReplaceTargetPicker,
  openImagesErrorToast,
} from "./open-images-flow";
export {
  writeTemporaryWavelengthStackTiffFixtures,
  writeTemporaryCorruptImageFixture,
  type WavelengthStackFixtureFile,
} from "./temporary-open-images-fixtures";
export {
  saveImageFormatPicker,
  saveImageFormatRadioGroup,
  readOfferedSaveImageFormatLabels,
  chooseSaveImageFormat,
  confirmSaveImageFormat,
  cancelSaveImageFormatPicker,
  exportSelectedStackThroughSaveDialog,
  loadImageFromAbsolutePath,
  createTemporaryExportDirectory,
  type SaveImageExportRequest,
} from "./save-image-flow";
export {
  saveProjectBundleThroughSaveDialog,
  openProjectBundleThroughOpenDialog,
  createTemporaryProjectBundleDirectory,
  type SaveProjectBundleRequest,
  type OpenProjectBundleRequest,
} from "./project-bundle-flow";
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
export {
  operationRegionPlaceholder,
  selectOperationRegionButton,
  expectOperationAwaitsItsOwnRegion,
  selectOperationRegionByDrag,
  type OperationRegionDragRequest,
} from "./operation-region-picker";
export {
  committedRoiBorderRects,
  committedRoiCornerHandleRects,
  expectExactlyOneCommittedRoi,
  expectNoCommittedRoiMarkers,
  plainClickImagePixel,
} from "./roi-inspection";
export {
  FULL_STACK_SCOPE_LABEL,
  BAND_WISE_SCOPE_LABEL,
  SHARED_SCOPE_OPTION_LABELS,
  scopeFieldset,
  scopeOptionRadios,
  scopeOptionRadio,
  expectScopeControlOffersExactlyTheSharedTwoOptions,
  selectFullStackScope,
  selectBandWiseScopeForBands,
} from "./cube-scope-control";
