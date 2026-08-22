# Built-in Local (spatially adaptive) PCA for CHARM Toolbox.
#
# Adapted from tasks/client-code/localPCA-fast.py (Wallace, August 2026), a
# modification of code from:
# [1] W. Peaslee, S. Faigenbaum-Golovin, M. Melchiorre Di Crescenzo, N. Daly,
# C. Higgitt, I. Daubechies, and B. Sober. Spatially Adaptive Dimension
# Reduction of Hyperspectral Images and Methods for Underdrawing Visualization.
# In preparation.
#
# Adaptations from the original script (the localPCA body is otherwise verbatim):
# - The original's trailing example (ENVI open, normArr, PIL save) is dropped;
#   this version exposes run(cube, wavelengths, params); no file I/O.
# - The cube arrives band-major (bands, height, width); it is transposed to the
#   original's (height, width, bands) layout and the (m, n) result is returned
#   as a one-band band-major cube.
# - localPCA gains an optional progress callback reporting after each grid row
#   of the first double loop (the original's comment notes progress is tracked
#   by checking these loops); wired to params["report_progress"].
# - params: "step" (pcaStep; the original signature has no default, the
#   built-in defaults to 8), "radius" (default None -> step, as the original),
#   "meanCenter" (default True, as the original).

import numpy as np
from scipy.ndimage import map_coordinates
from scipy.ndimage import uniform_filter
from sklearn.decomposition import PCA


def localPCA(cube, pcaStep, radius = None, meanCenter = True, progress = None):
    '''
    Computes local PCA (spatially adaptive PCA, variant of Geographyically Weighted PCA)
    A variant with a constant box kernel and interpolated projections for speed.
    cube is height x width x bands numpy array of multi/hyperspectral data
    pcaStep is an int giving the number of pixels to skip for each PCA computation
    radius is an int giving the radius of the box kernel used for weighting, defaulting to pcaStep

    To speed up, increase pcaStep and decrease radius
    Can be parallelized if needed
    Progress can be tracked by checking the for loops, with the first
    double for loop taking the majority of the time in most cases
    meanCenter will center the mean of the cube before applying local PCA
    '''

    if radius is None:
        radius = pcaStep

    m, n, b = cube.shape
    projectors = np.zeros((m//pcaStep + 1, n//pcaStep + 1, b))


    #Compute principal components on a rough grid
    iGrid = np.arange(0, m, pcaStep)
    jGrid = np.arange(0, n, pcaStep)
    assert len(iGrid) > 0 and len(jGrid) > 0
    prevPC = np.zeros((b))
    for indxI, i in enumerate(iGrid):
        lowerI = max(0, i - radius)
        upperI = min(m, i + radius + 1)
        for indxJ, j in enumerate(jGrid):
            lowerJ = max(0, j - radius)
            upperJ = min(n, j + radius + 1)

            window = cube[lowerI:upperI, lowerJ:upperJ, :]
            spectra = window.reshape(window.shape[0]*window.shape[1], window.shape[2])
            pca = PCA(n_components = 1)
            pca_object = pca.fit(spectra)
            currPC = pca_object.components_[0]

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
    queryI = np.arange(m)/pcaStep
    queryJ = np.arange(n)/pcaStep
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
    pcaStep = int(params.get("step", DEFAULT_STEP))
    if pcaStep < 1:
        raise ValueError("step must be at least 1")
    radius = params.get("radius")
    radius = int(radius) if radius is not None else None
    meanCenter = bool(params.get("meanCenter", True))

    hwb = np.ascontiguousarray(np.transpose(cube, (1, 2, 0)))
    result = localPCA(hwb, pcaStep, radius, meanCenter, progress=report_progress)
    report_progress(1.0)
    return result[np.newaxis, :, :]
