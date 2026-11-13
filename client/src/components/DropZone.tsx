import { useRef } from "react";
import { buttonClass } from "./Button";
import { UploadIcon } from "./Icons";

interface DropZoneProps {
  /** True while a file is being dragged over the page (files can be dropped anywhere). */
  dragOver: boolean;
  maxUploadBytes: number;
  onFile: (file: File) => void;
}

/** Before a check: the big "drop a file" box. */
export function DropZone({ dragOver, maxUploadBytes, onFile }: DropZoneProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const browse = () => fileInput.current?.click();
  const MB = 1048576;
  const limit = maxUploadBytes ? ` · up to ${(maxUploadBytes / MB).toFixed(maxUploadBytes < 10 * MB ? 1 : 0)} MB` : "";

  return (
    <section className="grid flex-1 content-center justify-items-center gap-7">
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose an EDM template zip or exported email to check"
        onClick={browse}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            browse();
          }
        }}
        className={`grid w-full max-w-[640px] cursor-pointer justify-items-center gap-3.5 rounded-[20px] border-2 border-dashed bg-surface px-5 py-9 text-center shadow-card transition hover:border-brand hover:bg-[color-mix(in_srgb,var(--brand)_4%,var(--surface))] md:px-8 md:py-14 ${
          dragOver ? "scale-[1.01] border-brand bg-[color-mix(in_srgb,var(--brand)_4%,var(--surface))]" : "border-line"
        }`}
      >
        <div className="grid size-16 place-items-center rounded-[18px] bg-cyan text-teal">
          <UploadIcon />
        </div>
        <h1 className="text-xl font-bold leading-tight tracking-[-.015em] md:text-2xl">Drop an EDM template or export</h1>
        <p className="max-w-[42ch] text-muted">
          Template zips are rendered with their sample data. Emails exported from Sesimi are used exactly as exported.
          Then it’s tested in the email clients you’ve selected.
        </p>
        <span className={buttonClass("primary")}>Browse files</span>
        <p className="text-[13px] text-muted">Template zip, or exported email (zip or HTML){limit}</p>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,.html,.htm,application/zip,text/html"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // so choosing the same file again still works
            if (file) onFile(file);
          }}
        />
      </div>

      <ol aria-label="How it works" className="m-0 flex list-none flex-wrap justify-center gap-x-7 gap-y-2.5 p-0 text-[13px] text-muted">
        {["Drop a template or export", "It’s rendered and sent to Mailgun", "Results open when ready"].map((text, i) => (
          <li key={text} className="flex items-center gap-2">
            <b className="grid size-[22px] place-items-center rounded-full border border-line bg-surface text-xs text-ink">{i + 1}</b>
            {text}
          </li>
        ))}
      </ol>
    </section>
  );
}
