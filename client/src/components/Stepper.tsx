import type { Step, StepKey, StepState } from "../hooks/useCheckRun";
import { CheckIcon } from "./Icons";

const ORDER: StepKey[] = ["render", "send", "clients", "ready"];

const dotClass: Record<StepState | "idle", string> = {
  idle: "border-line bg-surface",
  active: "border-brand bg-surface shadow-[0_0_0_4px_color-mix(in_srgb,#7af1ff_45%,transparent)] animate-pulse-soft",
  done: "border-done bg-done text-done-ink",
  error: "border-fail bg-fail",
  skipped: "border-dashed border-line bg-surface",
};

const labelClass: Record<StepState | "idle", string> = {
  idle: "font-medium text-muted",
  active: "font-semibold text-ink",
  done: "font-semibold text-ink",
  error: "font-semibold text-fail",
  skipped: "font-medium text-muted line-through decoration-[color-mix(in_srgb,var(--muted)_60%,transparent)]",
};

/** The four steps of a check. A row on wider screens, a column on phones. */
export function Stepper({ steps }: { steps: Record<StepKey, Step> }) {
  return (
    <ol className="m-0 grid list-none grid-cols-1 p-0 sm:grid-cols-4 sm:gap-3">
      {ORDER.map((key, i) => {
        const step = steps[key];
        const state = step.state ?? "idle";
        const isLast = i === ORDER.length - 1;
        return (
          <li key={key} className="relative grid min-w-0 gap-1 pb-4 pl-[30px] text-[13px] text-muted sm:pb-0 sm:pl-0 sm:pt-[30px]">
            {/* Dot */}
            <span
              aria-hidden="true"
              className={`absolute left-0 top-px grid size-[18px] place-items-center rounded-full border-2 sm:top-1 ${dotClass[state]}`}
            >
              {state === "done" && <CheckIcon />}
            </span>
            {/* Line to the next step (down on phones, across on wider screens) */}
            {!isLast && (
              <span
                aria-hidden="true"
                className={`absolute bottom-0.5 left-2 top-[22px] w-0.5 rounded-sm sm:bottom-auto sm:left-[26px] sm:right-1.5 sm:top-3 sm:h-0.5 sm:w-auto ${
                  state === "done" ? "bg-done" : "bg-line"
                }`}
              />
            )}
            <span className={`text-sm ${labelClass[state]}`}>{step.label}</span>
            {step.detail && <span className="[overflow-wrap:anywhere]">{step.detail}</span>}
          </li>
        );
      })}
    </ol>
  );
}
