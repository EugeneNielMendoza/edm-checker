interface EmailPreviewProps {
  html: string;
  note: string; // e.g. "Sample data · 600px wide"
}

/**
 * Shows the email at 600px wide. The iframe is sandboxed (no scripts, forms or pop-ups),
 * so the email can't affect this page.
 */
export function EmailPreview({ html, note }: EmailPreviewProps) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-[18px] py-3 text-[13px] font-semibold">
        <span>Rendered email</span>
        <span className="font-normal text-muted">{note}</span>
      </div>
      <div className="flex justify-center bg-surface-2 px-2 py-4 sm:px-4 sm:py-7">
        <iframe
          title="Rendered email"
          sandbox=""
          srcDoc={html}
          className="block h-[720px] w-[600px] max-w-full rounded border-0 bg-white shadow-frame sm:h-[900px]"
        />
      </div>
    </div>
  );
}
