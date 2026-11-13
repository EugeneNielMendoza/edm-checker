import type { ReactNode } from "react";
import type { ChipState, Run } from "../hooks/useCheckRun";
import { Button, buttonClass } from "./Button";
import { AlertIcon, ExternalIcon, RetryIcon } from "./Icons";
import { Stepper } from "./Stepper";

const chipClass: Record<ChipState, string> = {
  running: "bg-chip-run text-chip-run-ink",
  done: "bg-chip-done text-chip-done-ink",
  warn: "bg-warn-soft text-warn",
  error: "bg-fail-soft text-fail",
};

interface StatusCardProps {
  run: Run;
  onCheckAnother: () => void;
}

/** During and after a check: progress, results and errors. */
export function StatusCard({ run, onCheckAnother }: StatusCardProps) {
  const multiPage = run.pageCount > 1;
  return (
    <div className="grid gap-5 rounded-card border border-line bg-surface px-4 py-[18px] shadow-card sm:px-6 sm:py-[22px]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[.06em] text-muted">{run.eyebrow}</p>
          <h2 className="mt-0.5 text-[19px] font-bold leading-snug [overflow-wrap:anywhere]">{run.fileName}</h2>
          <p className="mt-1 text-[13px] text-muted [overflow-wrap:anywhere]">{run.summary}</p>
        </div>
        <span className={`inline-flex flex-none items-center gap-1.5 rounded-full px-[11px] py-[5px] text-xs font-semibold ${chipClass[run.chip.state]}`}>
          <span className={`size-[7px] rounded-full bg-current ${run.chip.state === "running" ? "animate-pulse-soft" : ""}`} />
          {run.chip.text}
        </span>
      </div>

      <Stepper steps={run.steps} />

      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${run.progress}%` }} />
      </div>

      {(run.results.length > 0 || run.notes.length > 0 || run.popupBlocked) && (
        <div className="grid gap-3.5">
          {run.results.map((result) => {
            const ok = result.failed.length === 0;
            const prefix = multiPage ? `Page ${result.page}: ` : "";
            return (
              <div key={result.testId} className="grid gap-3.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className={`font-semibold ${ok ? "text-pass" : "text-warn"}`}>
                    {prefix}
                    {ok
                      ? `All ${result.total} clients rendered`
                      : `${result.total - result.failed.length} of ${result.total} clients rendered`}
                  </span>
                  {result.shareUrl && (
                    <a href={result.shareUrl} target="_blank" rel="noopener" className={buttonClass("primary")}>
                      <ExternalIcon />
                      {multiPage ? `Open page ${result.page} in Mailgun` : "Open results in Mailgun"}
                    </a>
                  )}
                </div>
                {!ok && (
                  <div className="flex flex-wrap gap-1.5" aria-label="Clients that failed to render">
                    {result.failed.map((name, i) => (
                      <span key={`${name}-${i}`} className="rounded-full bg-fail-soft px-[9px] py-1 text-xs text-fail">
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {run.notes.map((note, i) => (
            <Note key={i}>{note}</Note>
          ))}
          {run.popupBlocked && (
            <Note>Tip: allow pop-ups for this page (icon at the right of the address bar) and results will open automatically.</Note>
          )}
        </div>
      )}

      {run.error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-[10px] border border-fail-line bg-[color-mix(in_srgb,var(--fail)_8%,transparent)] px-3.5 py-3 text-sm text-ink [overflow-wrap:anywhere]"
        >
          <AlertIcon className="mt-0.5 flex-none text-fail" />
          <span>{run.error}</span>
        </div>
      )}

      {run.finished && (
        <div className="flex flex-wrap gap-2.5">
          <Button variant="secondary" onClick={onCheckAnother}>
            <RetryIcon /> Check another EDM
          </Button>
        </div>
      )}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="border-l-[3px] border-line py-0.5 pl-3 text-[13px] text-muted">{children}</p>;
}
