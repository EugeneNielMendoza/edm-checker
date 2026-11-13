import { useState } from "react";
import { KEYS, storage } from "../lib/storage";

interface EmailPreviewProps {
  html: string;
  note: string; // e.g. "Sample data" or "As exported"
}

// Desktop is the usual 600px email width; mobile is a typical phone (iPhone 12–15).
const WIDTHS = { desktop: 600, mobile: 375 } as const;
type View = keyof typeof WIDTHS;

/**
 * Shows the email at desktop or phone width. The email's own mobile styles (media queries)
 * react to the width, like in a browser; real email apps can still differ, which is what the
 * Mailgun test is for. The iframe is sandboxed (no scripts, forms or pop-ups), so the email
 * can't affect this page.
 */
export function EmailPreview({ html, note }: EmailPreviewProps) {
  const [view, setView] = useState<View>(() => (storage.get(KEYS.previewWidth) === "mobile" ? "mobile" : "desktop"));

  function choose(next: View) {
    setView(next);
    storage.set(KEYS.previewWidth, next);
  }

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-[18px] py-2.5 text-[13px] font-semibold">
        <span>Rendered email</span>
        <div className="flex items-center gap-3">
          <span className="font-normal text-muted">
            {note} · {WIDTHS[view]}px wide
          </span>
          <div role="group" aria-label="Preview width" className="flex rounded-lg border border-line bg-surface-2 p-0.5">
            {(Object.keys(WIDTHS) as View[]).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => choose(v)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
                  view === v ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-center bg-surface-2 px-2 py-4 sm:px-4 sm:py-7">
        <iframe
          title="Rendered email"
          sandbox=""
          srcDoc={html}
          style={{ width: WIDTHS[view] }}
          className="block h-[720px] max-w-full rounded border-0 bg-white shadow-frame transition-[width] duration-300 sm:h-[900px]"
        />
      </div>
    </div>
  );
}
