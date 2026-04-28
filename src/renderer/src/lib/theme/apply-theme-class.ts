const DARK_THEME_CLASS_NAME = "dark";

export function applyDarkClassToDocumentRoot(isDark: boolean): void {
  document.documentElement.classList.toggle(DARK_THEME_CLASS_NAME, isDark);
}
