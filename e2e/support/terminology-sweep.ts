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
