# CT-310 e2e fixture: a custom ROP search objective. It scores one candidate
# projection by the raw contrast between the two painted mask categories of
# mask-multiband.png (category 1 = text, category 2 = background), with no
# normalization by the spread - unlike CNR, that makes the score depend on the
# MAGNITUDE of the projection, so the 50 candidates of a seeded search get
# genuinely different scores and the winner is unambiguous.
import numpy as np


def run(cube, wavelengths, params):
    band = cube[0]
    text = np.asarray(params["masks"][0]) != 0
    background = np.asarray(params["masks"][1]) != 0
    return float(np.mean(band[text]) - np.mean(band[background]))
