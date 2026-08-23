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
# - The reference values are the WHOLE stack's samples: every band contributes
#   its pixel values, with each 2D category mask applied across all bands (the
#   toolbox scores a stack against its masks, not a single grayscale image).
# - numBins comes from params["bins"] (the panel default is 255) and dataRange
#   is ALWAYS the actual data min-max (the original's dataRange=None branch),
#   never a bit-depth assumption - the guard for negative or strangely
#   normalized data.
# - The segmentation-map visualization, prints, and file saving are dropped.
# - Progress is reported through params["report_progress"].

import numpy as np


def run(cube, wavelengths, params):
    report_progress = params.get("report_progress") or (lambda fraction: None)
    numBins = int(params.get("bins", 255))
    if numBins < 2:
        raise ValueError("bins must be at least 2")
    maskArrs = [np.asarray(mask) != 0 for mask in params["masks"]]
    numClasses = len(maskArrs)
    assert (numClasses > 1), 'Please supply more than 1 mask.'
    for m in maskArrs:
        assert np.sum(m) > 0, 'Please ensure your mask is not empty'

    dataRange = (float(np.min(cube)), float(np.max(cube)))
    if dataRange[0] == dataRange[1]:
        dataRange = (dataRange[0], dataRange[0] + 1.0)
    report_progress(0.1)

    # begin computation of NPC (verbatim from the original, with cube[:, x]
    # pooling every band's values under mask x)
    histograms = [np.histogram(np.clip(cube[:, x], dataRange[0], dataRange[1]), bins=numBins, range=dataRange, density=False) for x in maskArrs]
    distributions = [x[0].astype('float')/np.sum(x[0]) for x in histograms]

    NPC = (sum([max([h[b] for h in distributions]) for b in range(numBins)]) - 1)/(numClasses-1)
    # end computation of NPC

    report_progress(1.0)
    return float(NPC)
