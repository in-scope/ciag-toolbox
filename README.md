# MSI Toolbox

[![Latest release](https://img.shields.io/github/v/release/in-scope/ciag-toolbox?include_prereleases)](../../releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)](../../releases)
[![Downloads](https://img.shields.io/github/downloads/in-scope/ciag-toolbox/total)](../../releases)

MSI Toolbox is a desktop application for inspecting and comparing images, built for academic image analysts in cultural heritage imaging: museum imaging scientists, conservators, and researchers in cultural heritage labs. If you are used to viewing images in MATLAB, Python (matplotlib / OpenCV), or Hoku, this tool aims to give you a fast, focused side-by-side viewing surface without having to write a script every time you want to compare two renderings.

This is an early release. It does the things listed below, and only those things. Future versions will add more.

## What the application does today

- Runs as a native desktop app on Windows and macOS.
- Opens **PNG** and **JPEG** images from your computer. New images land in the next empty cell automatically; if the grid is full, you are asked which cell to replace.
- Lays out a grid of **1, 2, 4, or 6** viewing cells. Available layouts are **1x1, 1x2, 2x1, 2x2, 2x3, and 3x2** (rows by columns). Empty cells show an **Open image** button so you always have a clear next step.
- Each cell is independent: it has its own image, its own pan/zoom, and its own display settings.
- **Pan** with click-and-drag inside a cell. **Zoom** with the mouse wheel, centered on your cursor so you can drill into a feature just by hovering over it. **Double-click** to reset the cell to fit the image.
- **Duplicate** a cell's image into another cell from the right-click menu. The duplicate auto-routes to the next empty cell, expands the grid if all cells are full, or prompts you to pick a cell to replace if the grid is already at its maximum size. Each copy is independent, so you can compare different display settings on the same image.
- Toggle a cell between **raw** display and **Normalized viewing** using the contrast icon in the cell's header strip. Normalized viewing stretches each band to its own minimum and maximum across the full display range, which can pull faint detail out of a low-contrast capture. It is a display aid only: it never changes the underlying data and is not recorded in the operation history.
- Step through the bands of a multi-band image with the **band control** at the bottom of the cell: drag the slider, type a band number, use the left/right step buttons, use the arrow keys, or scroll the mouse wheel over the control. Sweeping the slider or scrolling across many bands loads only the band you settle on, so jumping from band 1 to band 8 loads band 8 rather than every band in between. The control shows the current band and the total, and scales smoothly to images with hundreds of bands. Single-band images do not show it.
- Switch between **Light**, **Dark**, and **System** themes from **View > Theme**.

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
3. **First launch only**: double-click **MSI Toolbox** in your Applications folder. macOS will block it with a dialog saying it cannot be opened. Click **Done** to dismiss the dialog.
4. Click the Apple menu in the top-left of your screen and choose **System Settings**. In the sidebar, click **Privacy & Security**, then scroll down. Near the bottom you will see a message: *"MSI Toolbox was blocked to protect your Mac."* Click the **Open Anyway** button next to it.
5. macOS will prompt you to authenticate with Touch ID or your password, then show one more dialog. Click **Open Anyway** in that dialog too.
6. The app launches. From now on, double-clicking the icon works normally; this approval is one-time.

   This step is needed because the application is not signed by a paid Apple Developer account. Approving it through Privacy & Security is the standard, GUI-only way to grant the one-time exception.

## Getting Started

A five-minute first session.

1. **Launch the app.** You will see a single empty viewing cell labelled **No image loaded**, with an **Open image** button in the middle.
2. **Open an image.** Choose **File > Open Image...** from the menu, click the folder icon in the toolbar, or click the **Open image** button inside the empty cell. Pick any PNG or JPEG file. The image appears in the cell, and its filename appears in the cell's header strip.
3. **Pan and zoom.** Click-and-drag inside the cell to pan. Roll the mouse wheel to zoom in and out; the zoom is centered on your cursor, so you can drill into a feature just by hovering over it. Double-click anywhere in the cell to reset the view back to fit-to-cell.
4. **Switch to a multi-cell layout.** In the toolbar, click the grid icon and choose **2x2**. The work area splits into four cells, numbered 1 through 4. The image you opened stays in cell 1; cells 2-4 are empty, each with its own **Open image** button.
5. **Duplicate a cell.** Right-click your image (cell 1) and choose **Duplicate**. The image copies into the next empty cell (cell 2). The two copies are independent: you can pan, zoom, and adjust each one separately.
6. **Toggle normalized viewing on one cell.** In cell 2's header strip, click the contrast icon labelled **Normalized viewing**. Cell 2's image stretches each band to the full display range, which often reveals detail that was invisible in the raw view. Cell 1 is unchanged, so you can read the difference between raw and normalized side by side. Click the icon again to switch back to raw display.
7. **Compare bands and views across cells.** Because normalized viewing is a per-cell display setting, you can leave one cell raw and another normalized, or normalize each cell on a different band, and read the differences side by side. Nothing about the underlying image changes; everything is a visual adjustment.

That covers the full set of features in this release. The original image file on disk is untouched throughout; everything is a visual adjustment in the cell you are looking at.

## Keyboard and mouse reference

| Action | How |
|---|---|
| Open an image | **File > Open Image...**, the folder icon in the toolbar, or the **Open image** button inside an empty cell |
| Pan a cell | Click-and-drag inside the cell |
| Zoom a cell | Mouse wheel (centers on cursor) |
| Reset a cell to fit | Double-click inside the cell |
| Duplicate a cell | Right-click the cell, choose **Duplicate** |
| Toggle normalized viewing | Click the **Normalized viewing** contrast icon in the cell's header strip |
| Select a cell | Click the cell |
| Add a cell to the selection | Ctrl-click (Windows) or Cmd-click (macOS) the cell |
| Select a range of cells | Shift-click the cell at the end of the range |
| Clear selection | Click outside any cell |
| Apply an action to selected cells | Click the action in the toolbar; the confirm dialog uses your current selection as the pre-checked targets |
| Change theme | **View > Theme > System / Light / Dark** |

## Reporting issues

Found a bug, a confusing label, or a workflow you wish was supported? Open an issue at the [Issues page](../../issues). Screenshots help.
