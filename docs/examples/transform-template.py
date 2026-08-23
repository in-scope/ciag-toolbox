# Custom transform template for CHARM Toolbox.
#
# The toolbox calls run(cube, wavelengths=None):
#   cube        - numpy array of shape (bands, height, width); cube[k] is band k
#   wavelengths - one value per band when the stack carries them, else None
#
# Custom transform expects a whole cube back, shaped (N, height, width).
# The height, width, and band count N are all up to you: return a crop,
# resize, or any other spatial size >= 1. The output band count N must be
# at least 1.
#
# Importing this file into Custom transform only loads it: the status line
# reads "Tool loaded: transform-template.py". Clicking Apply runs it on the
# stack and opens the result as a new stack in a new panel. The file is
# re-read on every Apply, so you can edit it and click Apply again without
# re-importing.
#
# This template returns band-to-band differences, so the output stack has
# one band fewer than the source.
import numpy as np


def run(cube, wavelengths=None):
    return np.diff(cube, axis=0)
