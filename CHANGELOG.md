# Changelog

## [0.3.0](https://github.com/in-scope/ciag-toolbox/compare/v0.2.1...v0.3.0) (2026-06-15)


### Features

* **CT-076:** add shared full-cube vs band-wise scope parameter kind ([59954d3](https://github.com/in-scope/ciag-toolbox/commit/59954d39df59bbe5c370f0a1db17492645415017))
* **CT-077:** add shared makeFloatRasterFromBandComputation helper for float32 output ([af2e13f](https://github.com/in-scope/ciag-toolbox/commit/af2e13f168d031a6a009a1511ab5a655dbeb6546))
* **CT-078:** add flat-field correction with light/dark reference cubes ([acac2de](https://github.com/in-scope/ciag-toolbox/commit/acac2ded496604f4953d2f27bc29db8e2f6d390c))
* **CT-079:** add Spectralon reflectance calibration from a bright-target ROI ([c9a5bdf](https://github.com/in-scope/ciag-toolbox/commit/c9a5bdf2e450add2700307fbb6a5bb4d0de18f0c))
* **CT-080:** add histogram black/white-point contrast stretch ([f052168](https://github.com/in-scope/ciag-toolbox/commit/f0521683d606dae33f259fbcf65e7c07365ed0e0))
* **CT-081:** add brightness and contrast sliders as a data-changing band operation ([482a6ea](https://github.com/in-scope/ciag-toolbox/commit/482a6eaab1902c359321cf1902af40c584efd819))
* **CT-082:** add invert with a bounded-data-range guard ([95d7f37](https://github.com/in-scope/ciag-toolbox/commit/95d7f37ae026dcd0de2836e64f0d0c62d76adee2))
* **CT-083:** add data-changing linear normalize with full-cube and band-wise scope ([89c927c](https://github.com/in-scope/ciag-toolbox/commit/89c927c2da5143c6a6fcf21b9646e7629fcab4d4))
* **CT-084:** add standardize to target mean and std with full-cube and band-wise scope ([a5eaad8](https://github.com/in-scope/ciag-toolbox/commit/a5eaad88360460e24503cf472b48d09b432896ab))
* **CT-085:** convert 3-band RGB to a single grayscale band with luminance or custom weights ([f25e11b](https://github.com/in-scope/ciag-toolbox/commit/f25e11b825d31c4e97b1f5f1ab5b1fc09f0f04a2))
* **CT-086:** add false-color composite from three bands with live preview ([29c1343](https://github.com/in-scope/ciag-toolbox/commit/29c134306f394a2145c7e1388cd02a2294c14113))
* **CT-087:** add rotate (90/180/270 cw) and horizontal/vertical flip for the whole cube ([1519d30](https://github.com/in-scope/ciag-toolbox/commit/1519d3056a6a02686f0eed7d91fd2ef3997fbc3b))
* **CT-088:** persist the last two ROI spectra (mean +/- 1 sigma) on the spectra chart ([b23e267](https://github.com/in-scope/ciag-toolbox/commit/b23e267a13b884163cad3c3d6fe104b4c2503d55))
* **CT-090:** break spectra line/ribbon at removed middle bands instead of interpolating ([6ac2e58](https://github.com/in-scope/ciag-toolbox/commit/6ac2e584fc956f6ccf113a90b2fcd3839f17d77e))
* **CT-091:** remove a single band via an x in the band navigator, reusing the subset backend ([05794f4](https://github.com/in-scope/ciag-toolbox/commit/05794f4e893b905e52402d5745c638922b842ba8))
* **CT-092:** declutter right panel - drop bands list and pixel inspector, add live hover spectrum ([80130c4](https://github.com/in-scope/ciag-toolbox/commit/80130c4d5a46ca1e2a60ba1c44e5d9d3524a70d3))
* **CT-093:** re-home original band index/wavelength to metadata panel and history ([3149950](https://github.com/in-scope/ciag-toolbox/commit/3149950eb84129ed3059489d61a61b84effb21c3))
* **CT-094:** track the active band in the top panel header label ([b76ae0d](https://github.com/in-scope/ciag-toolbox/commit/b76ae0dce35d4e26b677195cadb2d412ce677cee))
* **CT-095:** request a per-operation region instead of consuming the inspection roi ([5756917](https://github.com/in-scope/ciag-toolbox/commit/5756917e1aea10aae9bde1fc56f23014bda9d8cc))
* **CT-096:** clear roi on tool deselect or outside click and stop stray selection markers ([ec7417d](https://github.com/in-scope/ciag-toolbox/commit/ec7417d427f7dcea4df63818eff568e4c00c6539))
* **CT-097:** auto-normalize then invert unbounded data, emitting both outputs ([045fb18](https://github.com/in-scope/ciag-toolbox/commit/045fb18894d3756f7d8aeb9082fe611333d3c629))
* **CT-098:** add pure monotone tone-curve engine subsuming black/white-point stretch ([80eb6b8](https://github.com/in-scope/ciag-toolbox/commit/80eb6b8d7319a544d52e6f6e56ed964a0c54e23b))
* **CT-099:** replace black/white markers with interactive multi-anchor tone-curve editor and live preview ([4941ade](https://github.com/in-scope/ciag-toolbox/commit/4941ade87dc2b5a355a3c31046a5f024a2109b2e))
* **CT-100:** superscript axis magnitudes, histogram count y-axis, and seamless bars ([577ea6f](https://github.com/in-scope/ciag-toolbox/commit/577ea6f62c17dcef56fcd571fd0d0cb135a6afae))
* **CT-101:** user-facing terminology sweep to band/stack/image/panel ([ed5744a](https://github.com/in-scope/ciag-toolbox/commit/ed5744a3cb040ef50e73cc403e819f21e8f28583))
* **CT-106:** show immediate, operation-specific loading state in new result panels ([f786f0b](https://github.com/in-scope/ciag-toolbox/commit/f786f0b541a051cf75145d52399018d82e2f46cd))
* **CT-107:** add robust percentile normalize option for outlier-fragile captures ([d357f97](https://github.com/in-scope/ciag-toolbox/commit/d357f97ff097a39723e5005db45aa181b3824562))
* **CT-108:** add spectra hover tooltip with per-band value crosshair ([7a36bcb](https://github.com/in-scope/ciag-toolbox/commit/7a36bcbf140b1e310f0d30508f8be3d22b585895))
* **CT-109:** auto-promote browser-decoded images to rasters so operations accept JPG/PNG ([e8c5a37](https://github.com/in-scope/ciag-toolbox/commit/e8c5a37cf8ed743fc0ab237d21fd2c7a75f59f4b))
* **CT-110:** replace band-wise scope with a band-range text input defaulting to the current band ([4b4c476](https://github.com/in-scope/ciag-toolbox/commit/4b4c4760c2cb66f8217c8845d89b4c659f0d308f))
* **CT-111:** broadcast single-band flat-field references and allow loaded panels as references ([0efd7b9](https://github.com/in-scope/ciag-toolbox/commit/0efd7b9d972d2b4b8f95785d308e48f38c0b4448))
* **CT-112:** add playwright electron harness with dev-server launch helper and smoke spec ([6588906](https://github.com/in-scope/ciag-toolbox/commit/65889065fe849f1cec3e4b0e98447d880b63833e))
* **CT-113:** add env-gated test-mode file-dialog stub and preload bridge ([347ef49](https://github.com/in-scope/ciag-toolbox/commit/347ef490bd5d330566c7664251898e9c8f6579f3))
* **CT-114:** add deterministic e2e fixture set with documented manifest ([e4a622a](https://github.com/in-scope/ciag-toolbox/commit/e4a622a7f211093c40fc5d4490ed12b46cd641d2))
* **CT-115:** add e2e page objects, readbacks, and status-bar test hooks ([b634cdb](https://github.com/in-scope/ciag-toolbox/commit/b634cdbf51d9f7f8ceebdccc5075eccf1005a415))
* **CT-116:** add operation/history/readout assertion utilities ([39877dd](https://github.com/in-scope/ciag-toolbox/commit/39877dd93cf256c8ecaa1671266ce1ee6e50ea40))
* **CT-117:** add main window shell, menus, and About dialog e2e spec ([c2d3f20](https://github.com/in-scope/ciag-toolbox/commit/c2d3f208884ff56a86e06aa9a36cdce50539eb4c))
* **CT-118:** add toolbar presence, accessible-name, and disabled-state e2e spec ([2d343ef](https://github.com/in-scope/ciag-toolbox/commit/2d343efe58a916b85b1b7c0c001d9632f0fe1dc3))
* **CT-119:** add webgl viewport render, non-blank, and context-loss e2e spec ([6543cc0](https://github.com/in-scope/ciag-toolbox/commit/6543cc00af2868961384b2cf5c801d8defc2c386))
* **CT-120:** add pan and zoom e2e spec ([6b243a9](https://github.com/in-scope/ciag-toolbox/commit/6b243a98e92bb676ba572125265da6ef40104200))
* **CT-121:** add configurable grid layout grow/shrink e2e spec ([f847b51](https://github.com/in-scope/ciag-toolbox/commit/f847b51d7d1a4a5c68712284044eb9f79930592a))
* **CT-122:** add panel selection (single, multi, range, clear) e2e spec ([592f06a](https://github.com/in-scope/ciag-toolbox/commit/592f06a7e0a3c0140320f442de6435c225631b73))
* **CT-123:** add duplicate-to-panel e2e spec ([3c570c2](https://github.com/in-scope/ciag-toolbox/commit/3c570c288cffff2a988f5947648cb4387a9f7457))
* **CT-124:** add per-panel normalized-viewing toggle e2e spec ([21bc803](https://github.com/in-scope/ciag-toolbox/commit/21bc8036651da03397abb58e245364407f941165))
* **CT-125:** add open images unified flow e2e spec ([f40f780](https://github.com/in-scope/ciag-toolbox/commit/f40f780c7d626f2b501e087fcb9febff609e7cb4))
* **CT-126:** add load formats and metadata e2e spec ([c3f5ccd](https://github.com/in-scope/ciag-toolbox/commit/c3f5ccdaa2a167bec2dcbdcc3e2e3d3ab51c74f7))
* **CT-127:** add numeric bit-shift e2e spec ([11da8f9](https://github.com/in-scope/ciag-toolbox/commit/11da8f9bd1b4d5476ff545b057f7fa37fa7b2268))
* **CT-128:** add save/export round-trip e2e spec ([7b8a96f](https://github.com/in-scope/ciag-toolbox/commit/7b8a96f2d3582c6471b6408a20f3de364aca43b6))
* **CT-129:** add project save and resume bundle round-trip e2e spec ([fff51ed](https://github.com/in-scope/ciag-toolbox/commit/fff51ed7d5c1bd40a1e1f892af3ce112fb42db49))
* **CT-130:** add spatial crop via per-operation region e2e spec ([719a0f7](https://github.com/in-scope/ciag-toolbox/commit/719a0f7a2f28618bf3dddf6ec869b76367eddb8d))
* **CT-131:** add band keep/remove and subset e2e spec ([141c483](https://github.com/in-scope/ciag-toolbox/commit/141c48310718d791f94a97a64544febee2ca38f1))
* **CT-132:** add ROI selection and Region stats e2e spec ([a01c607](https://github.com/in-scope/ciag-toolbox/commit/a01c607cd4e9e7cff45eca40430060075efbc378))
* **CT-133:** add pixel readout and live/pinned spectra e2e spec ([358cd50](https://github.com/in-scope/ciag-toolbox/commit/358cd5030973312c2842a6509d36aaf6e9705ba4))
* **CT-134:** add metadata panel and history audit trail e2e spec ([f9394be](https://github.com/in-scope/ciag-toolbox/commit/f9394be29ac0e60a5ac780d99a6a1d965031e07a))
* **CT-135:** add shared scope popup e2e spec ([66f42b5](https://github.com/in-scope/ciag-toolbox/commit/66f42b5a237bd9f7fcb1fc4ae2283ff1bbf249a6))
* **CT-136:** add operation-produced float32 pipeline e2e spec ([58ec3b4](https://github.com/in-scope/ciag-toolbox/commit/58ec3b458e4f3e0eba4d2150294a5e614b4ee3d8))
* **CT-137:** add flat-field correction e2e spec ([e03268f](https://github.com/in-scope/ciag-toolbox/commit/e03268ff2c40fb7c84435fc56d9c13f968442a5c))
* **CT-138:** add spectralon reflectance calibration e2e spec ([f673ffd](https://github.com/in-scope/ciag-toolbox/commit/f673ffd36f852967cc2a2a1d443723f8675e0f60))
* **CT-139:** add tone-curve operation e2e spec ([5ea4925](https://github.com/in-scope/ciag-toolbox/commit/5ea492504cee98c249faa92d04d7f904b034b3e7))
* **CT-140:** add brightness and contrast operation e2e spec ([dbf0926](https://github.com/in-scope/ciag-toolbox/commit/dbf092646e4e8ace4ecbd5ef568840f498c4209d))
* **CT-141:** add invert operation e2e spec ([ed97429](https://github.com/in-scope/ciag-toolbox/commit/ed974290c754d0b707af3e4b10c4948878a62dce))
* **CT-142:** add normalize full-cube vs band-wise operation e2e spec ([e216b37](https://github.com/in-scope/ciag-toolbox/commit/e216b372fa182065101d3013002351ec529224d2))
* **CT-143:** add standardize target mean and std e2e spec ([112d740](https://github.com/in-scope/ciag-toolbox/commit/112d7402c15c35cf92d210c72a8a855b46b54129))
* **CT-144:** add rgb to grayscale operation e2e spec ([8821d4f](https://github.com/in-scope/ciag-toolbox/commit/8821d4f9eb212120e84fbd9664122d221c129843))
* **CT-145:** add false-color composite order-sensitivity e2e spec ([fb391c6](https://github.com/in-scope/ciag-toolbox/commit/fb391c64db2a3b83918bd1098cf3c691065030c3))
* **CT-146:** add rotate and reflect geometry e2e spec ([28110cb](https://github.com/in-scope/ciag-toolbox/commit/28110cbb0caa944de695f225d827ccc008f82647))
* **CT-147:** add persistent ROI spectra e2e spec ([4fdc5df](https://github.com/in-scope/ciag-toolbox/commit/4fdc5dfd326eee7f994c0cdfe7b0caa2d8950859))
* **CT-148:** add default display data-type range e2e spec ([9aad530](https://github.com/in-scope/ciag-toolbox/commit/9aad530d810f976b691970b5a0032f2f84497f25))
* **CT-149:** add spectra gap handling for removed bands e2e spec ([625cad9](https://github.com/in-scope/ciag-toolbox/commit/625cad999bd2df8dfb760789ea6a97cc2a3ef934))
* **CT-150:** add remove-individual-bands via panel x e2e spec ([9a99514](https://github.com/in-scope/ciag-toolbox/commit/9a99514f126ce2b5547b7e3e4062371b35094e65))
* **CT-151:** add decluttered right panel order and live hover spectrum e2e spec ([39ca2a9](https://github.com/in-scope/ciag-toolbox/commit/39ca2a98b311a8b1585c0e74cedf6eb67e2b2202))
* **CT-152:** add original band index/wavelength metadata and history e2e spec ([b7fcc43](https://github.com/in-scope/ciag-toolbox/commit/b7fcc4394b1018c862bdcd3c406b718c81fecba9))
* **CT-153:** add top band/file label tracks band slider e2e spec ([a0f7068](https://github.com/in-scope/ciag-toolbox/commit/a0f7068f3e58c0f6649a35970342e5275910b09a))
* **CT-154:** add roi-inspection-only shared region-request e2e spec ([329615b](https://github.com/in-scope/ciag-toolbox/commit/329615ba17e748702ac0d28206d05b524b86b3e6))
* **CT-155:** add clear-roi/no-persisting-markers e2e spec with pan-zoom check ([aaaff47](https://github.com/in-scope/ciag-toolbox/commit/aaaff47a97703a45935fbd73b886a9b951868135))
* **CT-156:** add chart axis superscript/histogram polish e2e spec ([a14e763](https://github.com/in-scope/ciag-toolbox/commit/a14e763fcc1e8f16a8d602b02507697dbbbf48f0))
* **CT-157:** add terminology sweep e2e spec for band/stack/image/panel vocabulary ([82bef2c](https://github.com/in-scope/ciag-toolbox/commit/82bef2c33503d0127f86c1324ec6f62b976890ca))
* **CT-158:** add full stage-3 chain regression e2e spec with project round-trip ([bd0adfe](https://github.com/in-scope/ciag-toolbox/commit/bd0adfe455c8d0962d6c5f6b34e9c837c213c064))
* **CT-160:** load photometric-rgb tiffs as true-colour so colour images reopen in colour ([fbd031e](https://github.com/in-scope/ciag-toolbox/commit/fbd031e9824b7bbaae33028b9c4f0071257183bc))
* **CT-161:** auto-fit float display window so 32-bit float reopens visible instead of a white frame ([00669d9](https://github.com/in-scope/ciag-toolbox/commit/00669d9b771672bb1482686f6f4523760dd220b2))
* **CT-162:** disable envi and float export for photo sources with explaining tooltips ([54da6d1](https://github.com/in-scope/ciag-toolbox/commit/54da6d1f62c2faec32c3a14b580186201786c01b))
* **CT-163:** disclose that single-band exports save only the current band of a multi-band stack ([af9e674](https://github.com/in-scope/ciag-toolbox/commit/af9e67401ba93e5f53b8833e25ce5bbebe7e6f18))
* **toolbar:** mirror operations into Edit/Image menus, group toolbar, add quick rotate/reflect buttons ([2982868](https://github.com/in-scope/ciag-toolbox/commit/2982868ca84d614da363b6697113c4c1a93001d1))
* **toolbar:** split rotate & reflect into separate operations, menus, and panels ([085c4a3](https://github.com/in-scope/ciag-toolbox/commit/085c4a3d8872a227007bbc9378aecdcbf51c0916))
* use a red trash icon for band removal to signal a destructive action ([5e99c38](https://github.com/in-scope/ciag-toolbox/commit/5e99c388743378c2271ffdb89f2401d1a2cb196f))


### Bug Fixes

* **CT-102:** map float32 to integer range on TIFF save and add 32-bit float TIFF/ENVI save options ([5d8db25](https://github.com/in-scope/ciag-toolbox/commit/5d8db25e4c4fb7cf7fa19dace1dd4fd89c76bb3b))
* **CT-103:** reuse unchanged band buffers in band-wise float ops to avoid whole-cube reallocation OOM ([9dd462c](https://github.com/in-scope/ciag-toolbox/commit/9dd462c779ad293efc65f08aa280a56a0fd6dc60))
* **CT-104:** move tone-curve editor into the Tone Curve operation panel and keep the always-on histogram plain ([323784b](https://github.com/in-scope/ciag-toolbox/commit/323784b9e09197d2d3f1f71677835a50ea250307))
* **CT-105:** auto-select the new result panel after an operation opens it ([54de76d](https://github.com/in-scope/ciag-toolbox/commit/54de76d07475f6168c1580e9470d46a11f879e3a))
* **CT-159:** present true-color images as one color image, fix per-band red tint, move toasts bottom-left ([e1ff0df](https://github.com/in-scope/ciag-toolbox/commit/e1ff0df2241c779b2cbffde338ba1d7c2f670a64))
* **CT-159:** render true-color rasters as an RGB composite so rotate/reflect keep color ([fd9b3a1](https://github.com/in-scope/ciag-toolbox/commit/fd9b3a1ee9af25ef33c33571c17d5f921e9e2eb1))
* **history:** scroll only the history list and add sleek custom scrollbars ([75e2613](https://github.com/in-scope/ciag-toolbox/commit/75e261315cf6c99c787f16bca10426c87a92d832))


### Documentation

* **e2e:** correct stale comments claiming PNG/JPG cannot be transformed ([6994f15](https://github.com/in-scope/ciag-toolbox/commit/6994f157e77968bd69f627be5e8972731bc5af6d))
* **e2e:** document trace inspection and test-results clean script ([bf0ea2e](https://github.com/in-scope/ciag-toolbox/commit/bf0ea2e7a435c092385ddd567d7c9104e4a266aa))

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
