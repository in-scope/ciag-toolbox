# MSI Toolbox

[![Latest release](https://img.shields.io/github/v/release/in-scope/ciag-toolbox?include_prereleases)](../../releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)](../../releases)
[![Downloads](https://img.shields.io/github/downloads/in-scope/ciag-toolbox/total)](../../releases)

MSI Toolbox is a desktop application for inspecting and comparing images, built for academic image analysts in cultural heritage imaging: museum imaging scientists, conservators, and researchers in cultural heritage labs. If you are used to viewing images in MATLAB, Python (matplotlib / OpenCV), or Hoku, this tool aims to give you a fast, focused side-by-side viewing surface without having to write a script every time you want to compare two renderings.

This is an early release. It does the things listed below, and only those things. Future versions will add more.

## What the application does today

- Runs as a native desktop app on Windows and macOS.
- Opens **PNG** and **JPEG** images from your computer.
- Lays out a grid of **1, 2, 4, or 6** viewing cells. Available layouts are **1x1, 1x2, 2x1, 2x2, 2x3, and 3x2** (rows by columns).
- Each cell is independent: it has its own image, its own pan/zoom, and its own display settings.
- **Pan** with click-and-drag inside a cell. **Zoom** with the mouse wheel, centered on your cursor so you can drill into a feature just by hovering over it. **Double-click** to reset the cell to fit the image.
- **Duplicate** a cell's image into another cell with a right-click menu. Each copy is independent, so you can compare different display settings on the same image.
- Toggle each cell between **raw** display and **linearly normalized** display. Linear normalization stretches each color channel from its own minimum to its own maximum across the full display range, which can pull faint detail out of a low-contrast capture.
- Select multiple cells (Ctrl/Cmd-click to add or remove a cell, Shift-click to select a range) and **apply a display action to all selected cells at once**, for example, toggling normalization on every selected cell with a single click.

The application never modifies the image file on disk. All adjustments are visual, applied only to what you see in the cell.

## Installation

Download the latest installer for your computer from the [Releases page](../../releases). Pick the file that matches your operating system, run it, and launch **MSI Toolbox** from your Start menu (Windows) or Applications folder (macOS).

### Windows

1. From the [Releases page](../../releases), download the file ending in `Setup.exe`.
2. Double-click the installer and follow the prompts. Choose an install location and whether to add Start menu and desktop shortcuts.
3. Launch **MSI Toolbox** from the Start menu.

### macOS

1. From the [Releases page](../../releases), download the `.dmg` that matches your Mac's CPU:
   - **Apple silicon** (M1, M2, M3, M4, ...): the file ending in `arm64.dmg`.
   - **Intel**: the file ending in `x64.dmg`.

   If you are not sure which you have, click the Apple menu in the top-left of your screen, choose **About This Mac**, and look at the **Chip** or **Processor** line.
2. Open the `.dmg` and drag the **MSI Toolbox** icon into your **Applications** folder.
3. **First launch only**: open Finder, go to your Applications folder, right-click (or Control-click) the **MSI Toolbox** icon, choose **Open**, and then click **Open** in the dialog that appears. Subsequent launches work with a normal double-click.

   This extra step is needed because the application is not signed by Apple. macOS blocks unsigned applications when you double-click them; the right-click + Open path is the standard way to grant the one-time exception.

## Getting Started

A five-minute first session.

1. **Launch the app.** You will see a single empty viewing cell with a built-in test pattern (a red-green gradient with a blue checkerboard). The test pattern is just there so the cell is never blank.
2. **Open an image.** Choose **File > Open Image...** from the menu, or click the folder icon in the toolbar. Pick any PNG or JPEG file. The image appears in the cell, and its filename appears in the cell's header strip.
3. **Pan and zoom.** Click-and-drag inside the cell to pan. Roll the mouse wheel to zoom in and out; the zoom is centered on your cursor, so you can drill into a feature just by hovering over it. Double-click anywhere in the cell to reset the view back to fit-to-cell.
4. **Switch to a multi-cell layout.** In the toolbar, click the grid icon and choose **2x2**. The work area splits into four cells, numbered 1 through 4. The image you opened stays in cell 1; cells 2-4 show the test pattern.
5. **Duplicate a cell.** Right-click your image (cell 1) and choose **Duplicate to... > Viewport 2 (empty)**. The same image now appears in cell 2. The two copies are independent: you can pan, zoom, and adjust each one separately.
6. **Toggle normalization.** In cell 2's header strip, flip the **Normalize** switch on. The displayed image stretches its color channels to the full display range, which often reveals detail that was invisible in the raw view. Cell 1 is unchanged, so you can read the difference between raw and normalized side by side.
7. **Apply normalization to several cells at once.** Click cell 1 to select it, then Shift-click cell 4. All cells in the row-major range are now selected (you will see a blue ring on each). In the toolbar, click **Apply to Selected** and choose **Toggle Normalization**. The Normalize switch flips on for every selected cell at the same time.

That covers the full set of features in this release. The original image file on disk is untouched throughout; everything is a visual adjustment in the cell you are looking at.

## Keyboard and mouse reference

| Action | How |
|---|---|
| Open an image | **File > Open Image...** or the folder icon in the toolbar |
| Pan a cell | Click-and-drag inside the cell |
| Zoom a cell | Mouse wheel (centers on cursor) |
| Reset a cell to fit | Double-click inside the cell |
| Duplicate a cell | Right-click the cell, choose **Duplicate to... > Viewport N** |
| Toggle normalization on a cell | Flip the **Normalize** switch in the cell's header strip |
| Select a cell | Click the cell |
| Add a cell to the selection | Ctrl-click (Windows) or Cmd-click (macOS) the cell |
| Select a range of cells | Shift-click the cell at the end of the range |
| Clear selection | Click outside any cell |
| Apply an action to selected cells | Toolbar's **Apply to Selected** button |

## Reporting issues

Found a bug, a confusing label, or a workflow you wish was supported? Open an issue at the [Issues page](../../issues). Screenshots help.
