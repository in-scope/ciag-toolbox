# CT-213 e2e fixture: an imported band-selection tool that USES an import. It does
# an explicit `import numpy as np` (the exact statement script-docs-content.ts tells
# users to write) and returns a single H x W band computed with numpy: the per-pixel
# mean across bands. On multiband-12bit.tif (3 bands; at pixel (0,0) band 1 = 100,
# band 2 = 800, band 3 = 1600) the output reads (100 + 800 + 1600) / 3 = 833.333 at
# (0,0), a value distinct from any single band, so a passing assertion proves numpy
# actually computed the result under the bundled-mode sandbox.
import numpy as np


def run(cube, wavelengths=None):
    return np.mean(cube, axis=0)
