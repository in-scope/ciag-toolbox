# CT-209 e2e fixture: an imported band-weighting tool. run(cube) returns an
# N-length weight vector that selects the LAST band (weight 1 on it, 0 elsewhere),
# so the weighted sum equals that band exactly. On multiband-12bit.tif (3 bands,
# band 3 = 1600 at pixel (0,0)) the output reads 1600 at (0,0).
def run(cube, wavelengths=None):
    band_count = cube.shape[0]
    weights = [0.0] * band_count
    weights[-1] = 1.0
    return weights
