# Built-in Local (spatially adaptive) MNF for CHARM Toolbox.
#
# Adapted from tasks/client-code/localMNF-fast.py (Wallace, August 2026), a
# modification of code from:
# [1] W. Peaslee, S. Faigenbaum-Golovin, M. Melchiorre Di Crescenzo, N. Daly,
# C. Higgitt, I. Daubechies, and B. Sober. Spatially Adaptive Dimension
# Reduction of Hyperspectral Images and Methods for Underdrawing Visualization.
# In preparation.
#
# Adaptations from the original script (the localMNF body is otherwise verbatim):
# - This version exposes run(cube, wavelengths, params); no file I/O.
# - The cube arrives band-major (bands, height, width); it is transposed to the
#   original's (height, width, bands) layout and the (m, n) result is returned
#   as a one-band band-major cube.
# - localMNF gains an optional progress callback reporting after each grid row
#   of the first double loop (the original's comment notes progress is tracked
#   by checking these loops); wired to params["report_progress"].
# - params: "step" (mnfStep; the original signature has no default, the
#   built-in defaults to 8), "radius" (default None -> step, as the original),
#   "meanCenter" (default True, as the original).
# - The cube is promoted to float64 before the MNF loop: the original consumed
#   float64 ENVI data, and spectral's covariance/eigen math is unstable on the
#   worker's float32 wire format.

import numpy as np
from scipy.ndimage import map_coordinates
from scipy.ndimage import uniform_filter
import spectral as spec


def localMNF(cube, mnfStep, radius = None, meanCenter = True, progress = None):
    '''
    Computes local MNF (spatially adaptive MNF)
    A variant with a constant box kernel and interpolated projections for speed.
    cube is height x width x bands numpy array of multi/hyperspectral data
    mnfStep is an int giving the number of pixels to skip for each MNF computation
    radius is an int giving the radius of the box kernel used for weighting, defaulting to mnfStep

    Returns numpy array of size (m,n)

    To speed up, increase mnfStep and decrease radius
    Can be parallelized if needed
    Progress can be tracked by checking the for loops, with the first
    double for loop taking the majority of the time in most cases
    meanCenter will center the mean of the cube before applying local MNF
    '''

    if radius is None:
        radius = mnfStep

    m, n, b = cube.shape
    projectors = np.zeros((m//mnfStep + 1, n//mnfStep + 1, b))


    #Compute principal components on a rough grid
    iGrid = np.arange(0, m, mnfStep)
    jGrid = np.arange(0, n, mnfStep)
    assert len(iGrid) > 0 and len(jGrid) > 0
    prevPC = np.zeros((b))
    for indxI, i in enumerate(iGrid):
        lowerI = max(0, i - radius)
        upperI = min(m, i + radius + 1)
        for indxJ, j in enumerate(jGrid):
            lowerJ = max(0, j - radius)
            upperJ = min(n, j + radius + 1)

            window = cube[lowerI:upperI, lowerJ:upperJ, :]

            signal = spec.calc_stats(window)
            noise = spec.noise_from_diffs(window)
            mnfObject = spec.mnf(signal, noise)
            mnfTransform = mnfObject.get_reduction_transform(num=1)
            currPC = mnfTransform._A[0]

            if indxJ > 0:
                prevPC = projectors[indxI, indxJ - 1]
            else:
                if indxI > 0:
                    prevPC = projectors[indxI - 1, indxJ]
                else:
                    prevPC = np.zeros((b))
            if np.dot(currPC, prevPC) <= 0:
                currPC *= -1
            projectors[indxI, indxJ] = currPC
        if progress is not None:
            progress((indxI + 1) / len(iGrid) * 0.9)


    #Compute projections on a finer grid
    queryI = np.arange(m)/mnfStep
    queryJ = np.arange(n)/mnfStep
    coordsI, coordsJ = np.meshgrid(queryI, queryJ, indexing = 'ij')

    interpolatedPC = np.stack([
        map_coordinates(projectors[:,:,bIndex], [coordsI, coordsJ], order = 1, mode = 'nearest')
        for bIndex in range(b)], axis=-1)

    if meanCenter:
        local = uniform_filter(cube, size = (2*radius+1, 2*radius+1,1), mode = 'nearest')
        cube = cube - local

    return np.sum(interpolatedPC * cube, axis = 2)


DEFAULT_STEP = 8


def run(cube, wavelengths, params):
    report_progress = params.get("report_progress") or (lambda fraction: None)
    mnfStep = int(params.get("step", DEFAULT_STEP))
    if mnfStep < 1:
        raise ValueError("step must be at least 1")
    radius = params.get("radius")
    radius = int(radius) if radius is not None else None
    meanCenter = bool(params.get("meanCenter", True))

    hwb = np.ascontiguousarray(np.transpose(cube, (1, 2, 0)).astype(np.float64))
    result = localMNF(hwb, mnfStep, radius, meanCenter, progress=report_progress)
    report_progress(1.0)
    return result[np.newaxis, :, :]
