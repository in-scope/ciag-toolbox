# Multi-module .zip tool template for MSI Toolbox.
#
# A .zip tool must contain a top-level main.py that defines
# run(cube, wavelengths=None). The archive is extracted with its folder on
# the import path, so sibling modules import normally: helpers.py sits next
# to this file and is imported below.
#
# To use this template, zip the CONTENTS of this folder (main.py at the
# archive root, not inside a subfolder) and import the .zip.
#
# This tool weights each band by its variance, normalizes the weights via
# the helper module, and returns the weighted average band (a
# height-by-width band, suiting band selection).
import numpy as np

from helpers import normalize_band_weights


def run(cube, wavelengths=None):
    weights = normalize_band_weights(cube.var(axis=(1, 2)))
    return np.tensordot(weights, cube, axes=(0, 0))
