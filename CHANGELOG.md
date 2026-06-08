# Changelog

## [0.2.1](https://github.com/in-scope/ciag-toolbox/compare/v0.2.0...v0.2.1) (2026-06-08)


### Features

* **CT-063:** rename normalize to normalized viewing as a view-only per-cell toggle ([1cf58fc](https://github.com/in-scope/ciag-toolbox/commit/1cf58fc261c6513a2a72c62ca2b146ecdeef833b))
* **CT-064:** add min/max/zero x-axis tick labels to right-panel histogram ([c510c32](https://github.com/in-scope/ciag-toolbox/commit/c510c3217728a09ded8bd765b5a66fa3b1659713))
* **CT-067:** preserve original band indices/labels after Keep Bands ([289385a](https://github.com/in-scope/ciag-toolbox/commit/289385a57b3735f639d8e5cd4c5e9748c8dc4c58))
* **CT-068:** reword bit shift parameter help text into plain language ([9a62ec7](https://github.com/in-scope/ciag-toolbox/commit/9a62ec7e482af286667349eacabd81ed2ab520ed))
* **CT-069:** add on-viewport band slider with numeric input for multi-band sources ([2694e7a](https://github.com/in-scope/ciag-toolbox/commit/2694e7a0bceb814d33bda5fb65f29c2b98aa2971))
* **CT-070:** add documented configurable 16 GiB openable file size guard ([8d3943e](https://github.com/in-scope/ciag-toolbox/commit/8d3943ea7e5a2531fd0dd808fb86b266d0b1dff3))
* **CT-073:** debounce band-slider loading and add previous/next step buttons ([30ee70c](https://github.com/in-scope/ciag-toolbox/commit/30ee70ca5aba4640442673a103d33be3a9db3775))
* **CT-074:** show preserved original band index in bands list, pixel inspector, status bar, and histogram ([28c9e11](https://github.com/in-scope/ciag-toolbox/commit/28c9e11c8a753ff592d05948c1fd5fc456749715))
* **CT-075:** widen replace-target picker names and add a hover tooltip for the full name ([d1efb70](https://github.com/in-scope/ciag-toolbox/commit/d1efb70fc4fd1883922ce38ce912547e001f98da))


### Bug Fixes

* **CT-059:** grow grid and fill empty cells before prompting to replace when opening many images ([92e8073](https://github.com/in-scope/ciag-toolbox/commit/92e807375f96d178f09eb634ff61b44e52c5e486))
* **CT-060:** key roi corner handles by stable position so dragging does not leave stray points ([108b0b0](https://github.com/in-scope/ciag-toolbox/commit/108b0b0de836399d4e8443c32b4914a098008ed5))
* **CT-061:** stream unmodified on-disk sources into project bundles instead of re-encoding large rasters through ipc ([bdc741a](https://github.com/in-scope/ciag-toolbox/commit/bdc741a226f7444a024f3012e577e96bea2b301f))
* **CT-062:** map data-type range to black-to-white by default, fix signed-int and float display scaling ([ff341c6](https://github.com/in-scope/ciag-toolbox/commit/ff341c65344ea6b493ad4945fc0e0b60ffcc6c0c))
* **CT-065:** tile histogram bars on integer pixel edges to remove missing-stripe artifact ([c1ae520](https://github.com/in-scope/ciag-toolbox/commit/c1ae520e493dcdd439fc197dea753f005121c83e))
* **CT-066:** space spectra x-axis ticks evenly across value range to prevent overlap after band subsetting ([ab483ff](https://github.com/in-scope/ciag-toolbox/commit/ab483ffdf04e30d0804bda56a23c344010636167))
* **CT-072:** paint save progress indicator before the heavy raster bake blocks the renderer ([7ed8846](https://github.com/in-scope/ciag-toolbox/commit/7ed88467b6f631085a586d3b29b3e9a02c1fc104))


### Miscellaneous

* release 0.2.1 ([3c313a4](https://github.com/in-scope/ciag-toolbox/commit/3c313a4d2e979dca04c3a26ccc56481ceea34a30))

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
