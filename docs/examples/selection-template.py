# Band selection template for CHARM Toolbox.
#
# The toolbox calls run(cube, wavelengths=None):
#   cube        - numpy array of shape (bands, height, width); cube[k] is band k
#   wavelengths - one value per band when the stack carries them, else None
#
# Band selection expects a single band back: a height-by-width array matching
# the stack's spatial size. The toolbox opens it in a new panel.
#
# This template computes the per-pixel maximum across all bands of the stack.
import numpy as np


def run(cube, wavelengths=None):
    return np.max(cube, axis=0)
