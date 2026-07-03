# CT-210 e2e fixture: an imported band-selection tool. run(cube) returns a single
# H x W band (the LAST band of the stack) so the output equals that band exactly.
# On multiband-12bit.tif (3 bands, band 3 = 1600 at pixel (0,0)) the output reads
# 1600 at (0,0).
def run(cube, wavelengths=None):
    last_band_index = cube.shape[0] - 1
    return cube[last_band_index]
