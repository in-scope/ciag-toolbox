# Changelog

## [0.2.0](https://github.com/in-scope/ciag-toolbox/compare/v0.1.2...v0.2.0) (2026-05-14)

This is the first major content release after the initial scaffold. It introduces
the full image-loading, viewport-rendering, and operations stack that lets MSI Toolbox
load real multispectral data, inspect it, transform it, and save the result as a project.

Almost all of this work landed via [#3](https://github.com/in-scope/ciag-toolbox/issues/3).

### Image loading and formats

* **CT-023:** single-band TIFF loader and raster image source
* **CT-026:** multi-page TIFF support and per-viewport band selection
* **CT-027:** ENVI `.hdr` + binary loader with interleave-aware reader
* **CT-028:** raw camera loader via lazy-loaded `libraw-wasm`
* **CT-054:** open multiple single-band TIFFs together as a multi-band image
* **CT-055:** unified Open Images flow (no more separate open-image vs. open-stack paths)
* **fix(load-tiff):** skip embedded thumbnail pages instead of rejecting multi-page TIFFs

### Rendering and viewport

* **CT-024:** tile-based R16F renderer for large rasters
* **CT-025:** single-band grayscale broadcast in the shader
* **feat(zoom):** allow zoom past pixel level and 25% beyond fit, sharpen mag filter

### Image processing operations

* **CT-029:** parametric operation framework for viewport actions
* **CT-030:** bit-shift operation with raster transform hook
* **CT-040:** spatial crop using ROI
* **CT-041:** band keep/remove for multi-band images
* **feat(bit-shift):** apply-to-region scope option

### Region of interest and analysis

* **CT-037:** pixel value readout in the status bar
* **CT-038:** spectra plot for multi-band images
* **CT-039:** rectangular ROI selection on a viewport
* **CT-057:** pixel inspector panel with per-band rows and slim status bar
* **CT-058:** active-band histogram panel with worker computation and section reorder

### Multi-band image support

* **CT-056:** active-band radio model for the Bands panel and Keep Bands modal
* **refactor(subset-bands):** replace Keep Bands modal with an inline right-panel section and toolbar toggle

### Grid layout and viewport management

* **CT-042:** add 1x3 and 3x1 grid layouts
* **CT-043:** collapse grid layout when closing a loaded viewport
* **CT-044:** auto-grow grid layout when opening an image
* **CT-045:** hide close and duplicate context-menu items on empty viewports
* **fix(grid):** preserve loaded images when collapsing layout on viewport close
* **fix(history):** inherit source viewport rendering state when duplicating

### Metadata and history

* **CT-035:** operation history audit trail with right-panel display
* **CT-036:** right-panel image metadata section with empty state

### Project save and export

* **CT-031:** image export with TIFF/PNG/JPEG format chooser
* **CT-032:** ENVI format write with paired `.hdr` / binary sidecar
* **CT-033:** project state save and load via `.ctproj`
* **CT-034:** pack project as `.ctbundle` archive with streaming zip
* **CT-053:** bundle-only project save with baked assets

### Performance

* **CT-051:** busy-state context and loading indicators for long-running flows
* **perf(stack-open):** stream files one at a time to avoid renderer OOM

### Theming

* **CT-046:** default theme to dark on first launch
* **CT-047:** strengthen panel borders in light theme

### Bug fixes

* **fix(CT-048):** clear stale ROI overlay after crop and tool toggle
* **fix(open-images-review):** smart file size display, single-row mode menu, image title, multi-band drag lock

### App identity

* MSI Toolbox app icon and startup splash screen

### Continuous Integration

* Initial release-please workflow ([#3](https://github.com/in-scope/ciag-toolbox/issues/3))
* Wire release-please into the build workflow so installers upload to the release ([#5](https://github.com/in-scope/ciag-toolbox/pull/5))
