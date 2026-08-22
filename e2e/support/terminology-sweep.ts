import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// CT-101 / manual section 27: the app uses a locked vocabulary (band / stack / image /
// panel). "viewport" is an internal identifier only and must never surface in
// user-facing text; "image" is reserved for file open/save controls. These readbacks
// sweep the rendered shell so a terminology regression fails the suite.

export async function readUserFacingTextAndAccessibleNames(page: Page): Promise<string> {
  return page.evaluate(() => {
    const visibleText = document.body.innerText;
    const labelledElements = Array.from(document.querySelectorAll("[aria-label],[title]"));
    const attributeText = labelledElements
      .map((element) => describeElementAccessibleAttributes(element))
      .join(" ");
    return `${visibleText}\n${attributeText}`;

    function describeElementAccessibleAttributes(element: Element): string {
      return `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""}`;
    }
  });
}

export async function expectNoUserFacingViewportWording(page: Page): Promise<void> {
  const sweptText = await readUserFacingTextAndAccessibleNames(page);
  expect(sweptText).not.toMatch(/\bviewport\b/i);
}

// CT-280: the FFT/Butterworth tool is named "Frequency Filters"; the old
// "Spatial Filter" wording must not surface in rendered text or accessible names.
export async function expectNoUserFacingSpatialFilterWording(page: Page): Promise<void> {
  const sweptText = await readUserFacingTextAndAccessibleNames(page);
  expect(sweptText).not.toMatch(/spatial filter/i);
}

// CT-289: the band-combining tool is named "Weighted Sum"; the old
// "Band Weighting" wording must not surface in rendered text or accessible names.
export async function expectNoUserFacingBandWeightingWording(page: Page): Promise<void> {
  const sweptText = await readUserFacingTextAndAccessibleNames(page);
  expect(sweptText).not.toMatch(/band weighting/i);
}

// CT-292: the composite tool is named "RGB Color Composite"; the old
// "False-color" wording must not surface in rendered text or accessible names.
export async function expectNoUserFacingFalseColorWording(page: Page): Promise<void> {
  const sweptText = await readUserFacingTextAndAccessibleNames(page);
  expect(sweptText).not.toMatch(/false-color/i);
}

// CT-294: the menu is "Basic Processing"; the hyphenated "Basic-Processing"
// wording must not surface in rendered text or accessible names.
export async function expectNoUserFacingBasicProcessingHyphenWording(
  page: Page,
): Promise<void> {
  const sweptText = await readUserFacingTextAndAccessibleNames(page);
  expect(sweptText).not.toMatch(/Basic-Processing/);
}

// CT-298: the app is named "CHARM Toolbox"; the old "MSI Toolbox"
// wording must not surface in rendered text or accessible names.
export async function expectNoUserFacingMsiToolboxWording(page: Page): Promise<void> {
  const sweptText = await readUserFacingTextAndAccessibleNames(page);
  expect(sweptText).not.toMatch(/MSI Toolbox/);
}
