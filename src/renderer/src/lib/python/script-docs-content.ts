// Pure content model for the "How to write a custom script" page (CT-208f).
// The dialog (script-docs-dialog.tsx) renders this data; keeping the copy here as a
// typed, unit-tested structure lets a Vitest test pin that every required topic and
// worked example survives future edits. Locked vocabulary throughout: "stack",
// "panel", "band" (never "viewport"; "image" only for Open/Export controls).

export interface ScriptDocsWorkedExample {
  caption: string;
  code: string;
}

export interface ScriptDocsSection {
  id: string;
  heading: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
  example?: ScriptDocsWorkedExample;
}

export const SCRIPT_DOCS_TITLE = "How to write a custom script";

export const SCRIPT_DOCS_INTRO =
  "You can drive band weighting and band selection with your own Python: type a " +
  "one-line formula, or import a script or multi-module tool. Both run against the " +
  "current stack and return a result the toolbox opens in a new panel.";

export const SCRIPT_DOCS_BUNDLED_PACKAGES = ["numpy", "scipy", "scikit-image"] as const;

const INLINE_FORMULA_SECTION: ScriptDocsSection = {
  id: "inline-formula",
  heading: "The inline formula",
  paragraphs: [
    "A formula is a single Python expression evaluated against cube (the stack as a " +
      "numpy array) and np (numpy). You do not write a function: the toolbox wraps your " +
      "expression as def run(cube): return <your expression>.",
    "A formula must be one expression. Multi-statement input is rejected, so use an " +
      "imported script when you need several lines.",
  ],
  example: {
    caption: "Weight each band by its own variance (returns an N-length weight vector):",
    code: "cube.var(axis=(1, 2))",
  },
};

const IMPORTED_SCRIPT_SECTION: ScriptDocsSection = {
  id: "imported-script",
  heading: "Imported .py or .zip scripts",
  paragraphs: [
    "Import a single .py file or a .zip of a multi-module tool. Your code must define " +
      "a top-level run(cube, wavelengths=None) function that returns the result.",
    "For a .zip, the required entry is a top-level main.py that defines run. The " +
      "archive is extracted with its folder on the import path, so imports between your " +
      "own modules resolve. A .zip without a top-level main.py defining run is rejected.",
  ],
  example: {
    caption: "A main.py that averages the stack with fixed per-band weights:",
    code: [
      "import numpy as np",
      "",
      "def run(cube, wavelengths=None):",
      "    weights = np.array([0.2, 0.3, 0.5])",
      "    return np.tensordot(weights, cube, axes=(0, 0)) / weights.sum()",
    ].join("\n"),
  },
};

const CUBE_SHAPE_SECTION: ScriptDocsSection = {
  id: "cube-shape",
  heading: "The cube your code receives",
  paragraphs: [
    "cube is a numpy array of shape (bands, height, width): cube[k] is band k as a " +
      "height-by-width picture. wavelengths, when the stack carries them, is a " +
      "one-per-band sequence; it is None otherwise, so give it a default.",
  ],
};

const RETURN_CONTRACT_SECTION: ScriptDocsSection = {
  id: "return-contract",
  heading: "What your tool must return",
  paragraphs: ["The expected return depends on which tool runs your code:"],
  bullets: [
    "Band selection: a single height-by-width band matching the stack's spatial size.",
    "Band weighting: an N-length weight vector, one weight per band.",
  ],
};

const BUNDLED_PACKAGES_SECTION: ScriptDocsSection = {
  id: "bundled-packages",
  heading: "Bundled packages",
  paragraphs: [
    "The bundled runtime ships numpy, scipy, and scikit-image (import skimage). pandas " +
      "is not bundled; if your tool needs it, use your own Python environment (below).",
  ],
};

const SANDBOX_SECTION: ScriptDocsSection = {
  id: "sandbox-limits",
  heading: "The sandbox (bundled mode)",
  paragraphs: [
    "By default your code runs sandboxed so a buggy or hostile script cannot touch your " +
      "machine. It runs with no filesystem or network access, imports limited to the " +
      "bundled packages plus a curated pure-compute part of the standard library, a " +
      "wall-clock time limit, and a memory bound (about 4 GB of address space on macOS " +
      "and Linux). A script that exceeds these is stopped and surfaced as an error.",
  ],
};

const OWN_ENVIRONMENT_SECTION: ScriptDocsSection = {
  id: "own-environment",
  heading: "Your own Python environment (opt-in)",
  paragraphs: [
    "For a tool with arbitrary third-party dependencies, point the toolbox at your own " +
      "interpreter or virtual environment under View > Python Environment. This own " +
      "environment is trusted and unsandboxed, so only run code you trust; the " +
      "wall-clock and memory limits still apply. The toolbox never installs packages.",
  ],
};

export const SCRIPT_DOCS_SECTIONS: readonly ScriptDocsSection[] = [
  INLINE_FORMULA_SECTION,
  IMPORTED_SCRIPT_SECTION,
  CUBE_SHAPE_SECTION,
  RETURN_CONTRACT_SECTION,
  BUNDLED_PACKAGES_SECTION,
  SANDBOX_SECTION,
  OWN_ENVIRONMENT_SECTION,
];
