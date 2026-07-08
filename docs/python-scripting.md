# Python scripting in MSI Toolbox

Three operations in the toolbox can run your own Python against the current stack:

- **Band weighting**: your code returns one weight per band and the toolbox builds a weighted average band.
- **Band selection**: your code returns a single computed band.
- **Custom transform**: your code returns a whole new cube, which the toolbox opens as a new stack.

Every result opens in a new panel by default, with an entry in the stack's audit trail.

## Two ways to provide code

### The inline formula

A formula is a single Python expression evaluated against `cube` (the stack as a numpy array) and `np` (numpy). You do not write a function: the toolbox wraps your expression as `def run(cube): return <your expression>`.

A formula must be one expression. Multi-statement input is rejected, so use an imported script when you need several lines.

Worked example: weight each band by its own variance. This returns an N-length weight vector, so it suits band weighting.

```python
cube.var(axis=(1, 2))
```

### Imported .py or .zip tools

Import a single `.py` file or a `.zip` of a multi-module tool. Your code must define a top-level `run(cube, wavelengths=None)` function that returns the result.

For a `.zip`, the required entry is a top-level `main.py` that defines `run`. The archive is extracted with its folder on the import path, so imports between your own modules resolve. A `.zip` without a top-level `main.py` defining `run` is rejected.

Worked example: a `main.py` that averages a 3-band stack with fixed per-band weights. This returns a height-by-width band, so it suits band selection.

```python
import numpy as np


def run(cube, wavelengths=None):
    weights = np.array([0.2, 0.3, 0.5])
    return np.tensordot(weights, cube, axes=(0, 0)) / weights.sum()
```

## The cube your code receives

`cube` is a numpy array of shape `(bands, height, width)`: `cube[k]` is band k as a height-by-width picture. `wavelengths`, when the stack carries them, is a one-per-band sequence; it is `None` otherwise, so give it a default.

## What your code must return

The expected return depends on which operation runs your code:

- **Band weighting**: an N-length weight vector, one weight per band of the stack.
- **Band selection**: a single height-by-width band matching the stack's spatial size.
- **Custom transform**: a cube of shape `(N, height, width)`. The height and width must match the source stack; the output band count N is free, any value of 1 or more, so returning fewer, more, or the same number of bands are all valid. When the output band count equals the source's, wavelengths and band labels carry through to the new stack; otherwise the new stack gets generic band labels and no wavelengths.

Every return must be numeric and finite: a result containing NaN or Inf is rejected.

## Bundled packages

The bundled runtime ships numpy, scipy, and scikit-image (import `skimage`). pandas is not bundled; if your tool needs it, use your own Python environment (below).

## The sandbox (bundled mode)

By default your code runs sandboxed so a buggy or hostile script cannot touch your machine:

- No filesystem or network access.
- Imports limited to the bundled packages plus a curated pure-compute part of the standard library (an import allowlist).
- A wall-clock time limit (see the limits below).
- A memory bound (about 4 GB of address space on macOS and Linux).

A script that exceeds these is stopped and surfaced as an error.

## Wall-clock limits

- Band weighting and band selection runs: 30 seconds.
- Custom transform (cube) runs: 120 seconds.

## Your own Python environment (opt-in)

For a tool with arbitrary third-party dependencies, point the toolbox at your own interpreter or virtual environment under View > Python Environment. This own environment is trusted and unsandboxed, so only run code you trust; the wall-clock and memory limits still apply. The toolbox never installs packages.

## Template scripts

Copy a template from [`docs/examples/`](examples/) and start from a working file:

- [`weighting-template.py`](examples/weighting-template.py): returns an N-length weight vector for band weighting.
- [`selection-template.py`](examples/selection-template.py): returns a height-by-width band for band selection.
- [`transform-template.py`](examples/transform-template.py): returns an (N, height, width) cube for custom transform.
- [`zip-tool-template/`](examples/zip-tool-template/): a multi-module tool whose required top-level [`main.py`](examples/zip-tool-template/main.py) imports a sibling [`helpers.py`](examples/zip-tool-template/helpers.py). Zip the folder's contents (with `main.py` at the archive root) and import the `.zip`.
