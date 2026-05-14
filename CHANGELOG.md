# Changelog

## [0.2.0](https://github.com/in-scope/ciag-toolbox/compare/ciag-toolbox-v0.1.2...ciag-toolbox-v0.2.0) (2026-05-14)


### Features

* Add MSI toolbox stage 2 ([#3](https://github.com/in-scope/ciag-toolbox/issues/3)) ([1efa08a](https://github.com/in-scope/ciag-toolbox/commit/1efa08a0dddbbeb073ab18876ebb4763a30fdcae))
* **CT-001:** scaffold electron + react + typescript + vite app ([f4f3464](https://github.com/in-scope/ciag-toolbox/commit/f4f3464da17e4b40d8c4d3a646b661009bae57ee))
* **CT-002:** wire tailwind v4 and shadcn/ui into the renderer ([293ac44](https://github.com/in-scope/ciag-toolbox/commit/293ac44a36bf567abed2ed113546acebdad3e8cd))
* **CT-003:** add main window shell with native menu and about dialog ([2c5e57f](https://github.com/in-scope/ciag-toolbox/commit/2c5e57f22b88c2f2118d4d52abde8b3cce0b8e9c))
* **CT-004:** add toolbar with open, grid layout, and apply-to-selected slots ([cb7ac06](https://github.com/in-scope/ciag-toolbox/commit/cb7ac0630937ebf9995b189559382d90b5b93a53))
* **CT-005:** add webgl2 viewport that renders a textured quad with built-in test image ([534ad79](https://github.com/in-scope/ciag-toolbox/commit/534ad79ee3886129ab98041870561cc389404128))
* **CT-006:** add pan and zoom to webgl viewport with cursor-anchored wheel zoom ([7b7e1cd](https://github.com/in-scope/ciag-toolbox/commit/7b7e1cd26e27d34dab8d4470633774acf7856d9a))
* **CT-007:** open png/jpeg from menu and toolbar with toast on error ([6ad3a5e](https://github.com/in-scope/ciag-toolbox/commit/6ad3a5efefb77b1c57ae2ce7668af660f14c3b7b))
* **CT-008:** configurable viewport grid from 1x1 up to 2x3 ([9b72e48](https://github.com/in-scope/ciag-toolbox/commit/9b72e48452740a4bc8c1cd13cda9a64263c5791d))
* **CT-009:** add single and multi viewport selection via context ([698ec79](https://github.com/in-scope/ciag-toolbox/commit/698ec7900dc795996a4f24e9e30d23d09a140067))
* **CT-010:** duplicate viewport content via right-click with overwrite confirmation ([c5c5f31](https://github.com/in-scope/ciag-toolbox/commit/c5c5f31ed088153480b6e50d3d2788c539454cf4))
* **CT-011:** per-viewport raw-vs-linearly-normalized rendering toggle ([6e9a8e9](https://github.com/in-scope/ciag-toolbox/commit/6e9a8e9b9e1efc2c75a84f0ef715c2d50ccffa84))
* **CT-012:** apply-to-selected-viewports framework with toggle normalization action ([0c76e71](https://github.com/in-scope/ciag-toolbox/commit/0c76e7124595079908f3af002cdaac3c646bc863))
* **CT-013:** electron-builder config for windows nsis installer ([8953f48](https://github.com/in-scope/ciag-toolbox/commit/8953f48c8bc5f397bbdd527b6e3bc727f6021d20))
* **CT-014:** electron-builder config for unsigned macos dmg ([2ecd181](https://github.com/in-scope/ciag-toolbox/commit/2ecd181df4d198780724bfb4bfe24f2ac53a45d9))
* **CT-015:** github actions release workflow for windows and macos artifacts ([86ed50b](https://github.com/in-scope/ciag-toolbox/commit/86ed50bfe004236a5f6c74eb3c297b0632cc59b8))
* **CT-018:** operation-first apply flow replaces Apply to Selected button ([1bb9eac](https://github.com/in-scope/ciag-toolbox/commit/1bb9eaca7b074ca8dac1bc680ff1f62c47cd007b))
* **CT-019:** refit toggle normalization into operation-first flow ([1e69ed2](https://github.com/in-scope/ciag-toolbox/commit/1e69ed29e0dfc79c635ac8d62a2f4129f8f25511))
* **CT-020:** route open image to next empty viewport with replace picker ([a9eacb5](https://github.com/in-scope/ciag-toolbox/commit/a9eacb50483c77bfb2a799a8018922d31382bdaa))
* **CT-021:** add theme switcher under view menu ([a07afe2](https://github.com/in-scope/ciag-toolbox/commit/a07afe2f5e4d13961b8007f2951db588cc316564))
* **toolbar:** disable tool buttons without a single-selected viewport with an image ([5b29502](https://github.com/in-scope/ciag-toolbox/commit/5b29502f72a529a7447b14e2f172b94f7bdb4f20))
* **tools:** apply via right-side panel with new-viewport switch ([4118112](https://github.com/in-scope/ciag-toolbox/commit/41181129f3bd190988e2feeeb49ce969b5d47a31))
* **viewport:** auto-route duplicate to empty cell or expanded grid ([b6d8b3c](https://github.com/in-scope/ciag-toolbox/commit/b6d8b3c6527e1dde5f6068142d59d1c16b462f3c))
* **viewport:** close cell and compact remaining indices ([c91cfc7](https://github.com/in-scope/ciag-toolbox/commit/c91cfc7648479c2df8a956876db13949b47cf7ee))
* **viewport:** replace test-image fallback with open image cta ([4e225ac](https://github.com/in-scope/ciag-toolbox/commit/4e225ac1d466492eb4f4850278fe89ae03f9e402))


### Bug Fixes

* **CT-017:** forward radix asChild props to gridcell host element ([1563eb3](https://github.com/in-scope/ciag-toolbox/commit/1563eb3f4c2d0b7effafa67277e33be37ce1d19e))
* **macos:** ad-hoc sign builds and document GUI install path ([#2](https://github.com/in-scope/ciag-toolbox/issues/2)) ([3783939](https://github.com/in-scope/ciag-toolbox/commit/3783939355c4f36ea0b6f98b72a4762d6244c13b))
* **viewport:** handle flat bands and empty images in normalization ([388479f](https://github.com/in-scope/ciag-toolbox/commit/388479fba593ab5ce316cc2dab53b427f15b0cea))


### Documentation

* add release, platform, and downloads badges to readme ([4dd3f6f](https://github.com/in-scope/ciag-toolbox/commit/4dd3f6f088be4490a4575e9c857e84c7174f1885))
* **CT-016:** rewrite readme for academic image analyst audience ([2eb78a3](https://github.com/in-scope/ciag-toolbox/commit/2eb78a3707c8e803f4081f2ad40cb3d31bcff9a5))
* update readme for current open, duplicate, and apply flows ([8e62d44](https://github.com/in-scope/ciag-toolbox/commit/8e62d44255fbb6eca89d5bbb5132b0654186eada))
