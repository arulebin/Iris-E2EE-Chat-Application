// Theme: "system" follows the OS, "light"/"dark" pin a choice. The resolved
// theme is written to <html data-theme> (index.css overrides tokens under
// [data-theme="dark"]). A matching inline script in index.html applies the
// same thing before first paint to avoid a flash.

export type ThemePref = "system" | "light" | "dark";

const KEY = "iris-theme";
const BG = { light: "#f7f8fb", dark: "#0b0d12" } as const;

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

function applyResolved(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BG[theme]);
}

export function setThemePref(pref: ThemePref) {
  if (pref === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, pref);
  applyResolved(resolveTheme(pref));
}

/** Call once at startup so "system" keeps tracking the OS after load. */
export function initTheme() {
  applyResolved(resolveTheme(getThemePref()));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getThemePref() === "system") applyResolved(resolveTheme("system"));
  });
}
