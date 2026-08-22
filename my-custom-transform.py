"""Custom transform for MSI Toolbox.

Import this file via Custom transform > Import script... (the status line
reads "Tool loaded: my-custom-transform.py"), then click Apply. Apply runs
this script on the stack and opens the result as a new stack in a new panel.
The file is re-read on every Apply, so you can edit it here and click Apply
again without re-importing.

Contract (from docs/python-scripting.md):
- The toolbox calls run(cube, wavelengths=None).
- cube is a numpy array of shape (bands, height, width); cube[k] is band k.
- wavelengths is a one-per-band sequence when the stack carries them,
  otherwise None, so it must have a default.
- The return must be a cube of shape (N, height, width). N, height, and
  width can be any size of 1 or more (return a crop, resize, or any other
  spatial dimensions as needed).
- Every value must be numeric and finite (no NaN or Inf).
- Runs are sandboxed by default (numpy, scipy, skimage available) with a
  120 second wall-clock limit for custom transforms.

This example normalizes each band independently to the 0..1 range, which
keeps the band count unchanged so wavelengths and band labels carry
through to the new stack.
"""

import numpy as np


def run(cube, wavelengths=None):
    cube = cube.astype(np.float64)
    # Per-band minimum and maximum, kept as (bands, 1, 1) so they
    # broadcast across each band's height-by-width picture.
    lo = cube.min(axis=(1, 2), keepdims=True)
    hi = cube.max(axis=(1, 2), keepdims=True)
    span = hi - lo
    # A flat band (max == min) would divide by zero and produce NaN,
    # which the toolbox rejects; map flat bands to all zeros instead.
    safe_span = np.where(span == 0, 1.0, span)
    normalized = (cube - lo) / safe_span
    return np.where(span == 0, 0.0, normalized)
