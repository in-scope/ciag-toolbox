# Built-in L2 binarization approximation for CHARM Toolbox.
#
# Adapted from tasks/client-code/l2_binarization_approximation.py (Wallace,
# August 2026). The L2BinarizationApproximation function is verbatim.
#
# Adaptations from the original script:
# - The original's test example (ENVI open, PIL mask loading, clamped uint8 PNG
#   save) and the unused spectral.io.envi import are dropped; this version
#   exposes run(cube, wavelengths, params) and receives everything as numpy
#   arrays from the worker.
# - The cube arrives band-major (bands, height, width); it is transposed to the
#   original's (m, n, b) layout for the computation and the (m, n) result is
#   returned as a one-band band-major cube.
# - lowerMask/upperMask are the first two arrays in params["masks"] (category
#   order), made boolean with != 0 exactly as the original's PNG loading did.
# - lowerVal/upperVal come from params, defaulting to the original signature's
#   0.0 and 1.0.
# - Progress is reported through params["report_progress"].

import numpy as np


def L2BinarizationApproximation(cube, lowerMask, upperMask, lowerVal = 0.0, upperVal = 1.0):
    '''
    Computes the linear combination of bands in the cube (with an additional constant band)
    that best approximates a binarized image consisting of pixels
    in lowerMask being at value lowerVal and pixels in upperMask being at value upperVal.

    cube is mxnxb numpy array of multispectral/hyperspectral data, where b is the number of bands.
    lowerMask is an mxn numpy boolean array, where values of true are labeled pixels in one class
    upperMask is an mxn numpy boolean array, where values of true are labeled pixels in the second class
    lowerVal is a float giving the target for pixels in lowerMask
    upperVal is a float giving the target for pixels in upperMask
    '''
    lowerSpectra = cube[lowerMask]
    upperSpectra = cube[upperMask]
    i, j, b = lowerSpectra.shape[0], upperSpectra.shape[0], cube.shape[2]
    if i + j < b + 1:
        raise ValueError(f"Need at least {b+1} labeled pixels, got {i+j}")

    spectra = np.ones((i + j, b + 1))       # last column stays 1 for constant band
    spectra[:i, :b] = lowerSpectra
    spectra[i:, :b] = upperSpectra

    res = np.zeros((i+j))
    res[:i] = lowerVal
    res[i:] = upperVal

    w = np.linalg.lstsq(spectra, res)[0]
    A = cube.reshape(cube.shape[0]*cube.shape[1], b)

    imgVals = np.matmul(A, w[:b]) + w[b]
    return imgVals.reshape(cube.shape[0], cube.shape[1])


def run(cube, wavelengths, params):
    report_progress = params.get("report_progress") or (lambda fraction: None)
    masks = params["masks"]
    if len(masks) < 2:
        raise ValueError("L2 minimization needs two masks")
    lowerVal = float(params.get("lowerVal", 0.0))
    upperVal = float(params.get("upperVal", 1.0))

    hwb = np.transpose(cube, (1, 2, 0))
    lowerMask = np.asarray(masks[0]) != 0
    upperMask = np.asarray(masks[1]) != 0
    report_progress(0.1)
    result = L2BinarizationApproximation(hwb, lowerMask, upperMask, lowerVal, upperVal)
    report_progress(1.0)
    return result[np.newaxis, :, :]
