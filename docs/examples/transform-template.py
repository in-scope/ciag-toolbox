# Custom transform template for MSI Toolbox.
#
# The toolbox calls run(cube, wavelengths=None):
#   cube        - numpy array of shape (bands, height, width); cube[k] is band k
#   wavelengths - one value per band when the stack carries them, else None
#
# Custom transform expects a whole cube back, shaped (N, height, width).
# The height and width must match the source stack; the output band count N
# is up to you, as long as it is at least 1. The toolbox opens the result
# as a new stack in a new panel.
#
# This template returns band-to-band differences, so the output stack has
# one band fewer than the source.
import numpy as np


def run(cube, wavelengths=None):
    return np.diff(cube, axis=0)
