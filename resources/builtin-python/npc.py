# Built-in Multi-Class Normalized Potential Contrast (NPC) score for CHARM Toolbox.
#
# Adapted from Wallace Peaslee's Multiple-Class-Normalized-Potential-Contrast
# repository (tasks/client-code/Multiple-Class-Normalized-Potential-Contrast/
# Multiple_Source_NPC.py, MIT license). See:
# [1] W. Peaslee, A. Breger and C.-B. Schoenlieb, "Potential Contrast:
# Properties, Equivalences, and Generalization to Multiple Classes,"
# EUSIPCO 2025, doi: 10.23919/EUSIPCO63237.2025.11226174.
#
# Adaptations from the original script (otherwise kept verbatim):
# - The original is a top-level, parameter-block-driven script that reads mask
#   PNGs and a grayscale reference image from disk with PIL. This version
#   exposes run(cube, wavelengths, params) and receives everything as numpy
#   arrays from the worker: no file I/O, no PIL, no invertMasks (the toolbox's
#   masks are already boolean-positive).
# - CT-318: run() returns a LIST with one NPC score per band, index = band
#   index. Every band is scored ON ITS OWN, exactly as the original scores one
#   grayscale image: the histograms are of that band's pixels under each 2D
#   category mask, and the binning range is THAT BAND's own min-max.
# - numBins comes from params["bins"] (the panel default is 255) and dataRange
#   is ALWAYS the actual data min-max (the original's dataRange=None branch),
#   never a bit-depth assumption - the guard for negative or strangely
#   normalized data, applied per band.
# - The segmentation-map visualization, prints, and file saving are dropped.
# - Progress is reported through params["report_progress"] after each band.

import numpy as np


def run(cube, wavelengths, params):
    report_progress = params.get("report_progress") or (lambda fraction: None)
    numBins = bin_count_or_raise(params)
    maskArrs = category_masks_or_raise(params)
    bandCount = int(cube.shape[0])
    scores = []
    for bandIndex in range(bandCount):
        scores.append(score_one_band(cube[bandIndex], maskArrs, numBins))
        report_progress((bandIndex + 1) / bandCount)
    return scores


def bin_count_or_raise(params):
    numBins = int(params.get("bins", 255))
    if numBins < 2:
        raise ValueError("bins must be at least 2")
    return numBins


def category_masks_or_raise(params):
    maskArrs = [np.asarray(mask) != 0 for mask in params["masks"]]
    assert (len(maskArrs) > 1), 'Please supply more than 1 mask.'
    for m in maskArrs:
        assert np.sum(m) > 0, 'Please ensure your mask is not empty'
    return maskArrs


# The band's own min-max, widened by 1.0 when the band is constant so that
# np.histogram still has a non-empty range to bin over.
def band_data_range(band):
    low = float(np.min(band))
    high = float(np.max(band))
    return (low, low + 1.0) if low == high else (low, high)


def score_one_band(band, maskArrs, numBins):
    numClasses = len(maskArrs)
    dataRange = band_data_range(band)

    # begin computation of NPC (verbatim from the original, with band[x]
    # selecting this band's values under mask x)
    histograms = [np.histogram(np.clip(band[x], dataRange[0], dataRange[1]), bins=numBins, range=dataRange, density=False) for x in maskArrs]
    distributions = [x[0].astype('float')/np.sum(x[0]) for x in histograms]

    NPC = (sum([max([h[b] for h in distributions]) for b in range(numBins)]) - 1)/(numClasses-1)
    # end computation of NPC

    return float(NPC)
