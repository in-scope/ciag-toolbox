# Band weighting template for CHARM Toolbox.
#
# The toolbox calls run(cube, wavelengths=None):
#   cube        - numpy array of shape (bands, height, width); cube[k] is band k
#   wavelengths - one value per band when the stack carries them, else None
#
# Band weighting expects an N-length weight vector: one weight per band of
# the stack. The toolbox normalizes the weights and builds a weighted
# average band from them.
#
# This template weights each band by its own variance, so busier bands
# contribute more to the weighted average.
import numpy as np


def run(cube, wavelengths=None):
    return cube.var(axis=(1, 2))
