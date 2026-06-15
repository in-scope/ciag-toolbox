import type { Locator, Page } from "@playwright/test";

// The History section (<section aria-label="History">) renders an ordered list
// (<ol aria-label="Operation history">). Each entry is an <article> whose first span
// is the operation name (actionLabel) and whose remaining direct-child spans hold the
// applied label and inline parameter/scope text. detailLines collects those extra
// spans so a spec can assert the recorded parameters and scope.

export interface HistoryEntryReadout {
  readonly actionLabel: string;
  readonly detailLines: ReadonlyArray<string>;
}

export function historySection(page: Page): Locator {
  return page.locator("section[aria-label='History']");
}

export function historyList(page: Page): Locator {
  return page.getByRole("list", { name: "Operation history" });
}

export function historyEntryCount(page: Page): Promise<number> {
  return historyList(page).locator("article").count();
}

export async function readHistoryEntries(page: Page): Promise<HistoryEntryReadout[]> {
  const articles = historyList(page).locator("article");
  const count = await articles.count();
  const entries: HistoryEntryReadout[] = [];
  for (let index = 0; index < count; index += 1) {
    entries.push(await readHistoryEntryFromArticle(articles.nth(index)));
  }
  return entries;
}

async function readHistoryEntryFromArticle(article: Locator): Promise<HistoryEntryReadout> {
  const actionLabel = (await article.locator("div span").first().innerText()).trim();
  const detailLines = await readHistoryEntryDetailLines(article);
  return { actionLabel, detailLines };
}

async function readHistoryEntryDetailLines(article: Locator): Promise<ReadonlyArray<string>> {
  const lines = await article.locator(":scope > span").allInnerTexts();
  return lines.map((line) => line.trim());
}
