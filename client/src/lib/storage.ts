// Small per-browser settings (theme, Preview only, last client list).
// localStorage can be unavailable (private windows, blocked storage), so failures are ignored.

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Not saved; the page still works.
    }
  },
};

export const KEYS = {
  theme: "edm-theme",
  previewOnly: "edm-preview-only",
  list: "edm-list",
} as const;
