// The file-name cleaner every export shares: an exported file's stem comes
// from user-controlled text (a source file name, a mask layer's name), so the
// characters no file system accepts are replaced before the name reaches a
// save dialog or a folder write.

// eslint-disable-next-line no-control-regex -- control characters are exactly what a file name must not contain
const CHARACTERS_INVALID_IN_FILE_NAMES = /[\\/:*?"<>|\x00-\x1f]/g;

export function sanitizeExportBaseName(text: string, fallback: string): string {
  const cleaned = text
    .replace(CHARACTERS_INVALID_IN_FILE_NAMES, "-")
    .replace(/[. ]+$/, "")
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}
