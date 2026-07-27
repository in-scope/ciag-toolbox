# CT-216 e2e fixture: an imported whole-stack transform tool. run(cube) returns
# the cube with its band order reversed, so band 1 of the output equals the
# source's last band. On multiband-12bit.tif (3 bands; band 3 = 1600 at pixel
# (0,0)) the first output band reads 1600 at (0,0).
import numpy as np


def run(cube, wavelengths=None):
    return np.flip(cube, axis=0)
