export interface ThirdPartyAcknowledgement {
  readonly name: string;
  readonly purpose: string;
  readonly license: string;
  readonly licenseText: string;
  readonly homepage: string;
}

export const THIRD_PARTY_ACKNOWLEDGEMENTS: ReadonlyArray<ThirdPartyAcknowledgement> = [
  {
    name: "libraw-wasm",
    purpose: "Decoding raw camera files (DNG, CR3, ARW, NEF, RAF, ORF, PEF, RW2)",
    license: "ISC",
    homepage: "https://www.npmjs.com/package/libraw-wasm",
    licenseText:
      "ISC License\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH\nREGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY\nAND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,\nINDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM\nLOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR\nOTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR\nPERFORMANCE OF THIS SOFTWARE.",
  },
  {
    name: "LibRaw",
    purpose: "Underlying C++ library compiled to WebAssembly inside libraw-wasm",
    license: "LGPL-2.1 / CDDL-1.0 (dual)",
    homepage: "https://www.libraw.org/",
    licenseText:
      "LibRaw is dual-licensed under the LGPL 2.1 and the CDDL 1.0. The full license\ntexts are available at https://www.libraw.org/about. Source for the LibRaw\nbuild used in libraw-wasm is published with the upstream package.",
  },
];
