# Helper module for the .zip tool template. main.py imports this as a plain
# sibling module; the extracted archive's folder is on the import path.
import numpy as np


def normalize_band_weights(weights):
    weights = np.asarray(weights, dtype=np.float64)
    total = weights.sum()
    if total == 0:
        return np.full(weights.shape, 1.0 / weights.size)
    return weights / total
