// CT-302: mask layer and category ids are generated from the ids already in
// use, so an id is never reused after a delete (an index-derived id would
// collide: delete "mask-1", add a layer, and the new one would take "mask-2"
// while the old "mask-2" is still there).

export function buildNextPrefixedIdentifier(
  prefix: string,
  existingIds: ReadonlyArray<string>,
): string {
  return `${prefix}-${findNextFreeNumberForPrefix(prefix, existingIds)}`;
}

export function findNextFreeNumberForPrefix(
  prefix: string,
  existingIds: ReadonlyArray<string>,
): number {
  const used = existingIds.map((id) => readNumberSuffixOrZero(prefix, id));
  return Math.max(0, ...used) + 1;
}

function readNumberSuffixOrZero(prefix: string, id: string): number {
  const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
  if (!match) return 0;
  return Number.parseInt(match[1] ?? "0", 10);
}
