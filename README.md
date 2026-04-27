# MSI Toolbox

A cross-platform desktop application for multispectral image analysis.

## Installation

### Windows

Download the latest `.exe` from the [Releases page](../../releases) and run the NSIS installer.

### macOS

Download the latest `.dmg` matching your CPU (Intel x64 or Apple silicon arm64) from the [Releases page](../../releases) and drag the app into Applications.

The macOS build is unsigned, so the first time you launch it you must right-click the app in Applications and choose **Open** (a normal double-click will be blocked).

## Cutting a release

Releases are produced by the `Release` GitHub Actions workflow (`.github/workflows/release.yml`), which builds the Windows installer and the two macOS dmgs in parallel and uploads them to a GitHub Release named after the tag.

To cut a release, push an annotated semver tag matching `v*.*.*` from the branch you want to release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow can also be triggered manually from the Actions tab via `Run workflow` (no tag needed); manual runs build and store the installers as workflow artifacts but do not create a GitHub Release.
