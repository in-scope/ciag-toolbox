# Built-in Random Orthogonal Projection (ROP) for CHARM Toolbox.
#
# Adapted from tasks/client-code/ROP.py (Anna Breger, July 2026).
#
# Adaptations from the original script (randOrth and dimReduction are verbatim
# apart from the injected generator):
# - The original is a top-level script that opens an image with PIL and shows
#   the projections with matplotlib. This version exposes
#   run(cube, wavelengths, params); no file I/O, no plotting.
# - The cube arrives band-major (bands, height, width); it is transposed to the
#   original's (height, width, bands) layout for the projection and the
#   projected bands are returned band-major.
# - Randomness comes from a per-run seeded numpy Generator (params["seed"]) so
#   every press is reproducible; the original drew from the global RandomState.
# - k is fixed at 1 (the toolbox always projects to one band per draw) and n
#   comes from params["count"] (default 1: one candidate per press).
# - The original notes the projections must be normalized before VIEWING; the
#   raw projected values are returned as the data (display normalization is the
#   app's job).
# - Progress is reported through params["report_progress"].

import numpy as np


# computes n orthogonal projections d->k
def randOrth(d, k, n, rng):
    randomSet = []
    while len(randomSet) < n:
        [Q, R] = np.linalg.qr(rng.normal(size=(d, k)))
        randomSet.append(Q)
    return randomSet


# computes the dimension Reduction
def dimReduction(image, projections):
    l = []
    for Q in projections:
        l.append(np.tensordot(image, Q, axes=([2], [0])))
    return l


def run(cube, wavelengths, params):
    report_progress = params.get("report_progress") or (lambda fraction: None)
    seed = int(params["seed"])
    count = int(params.get("count", 1))
    if count < 1:
        raise ValueError("count must be at least 1")
    rng = np.random.default_rng(seed)

    image = np.transpose(cube, (1, 2, 0))
    projections = randOrth(image.shape[2], 1, count, rng)
    report_progress(0.5)
    reconstruction = dimReduction(image, projections)
    report_progress(1.0)
    return np.stack([r[:, :, 0] for r in reconstruction], axis=0)
