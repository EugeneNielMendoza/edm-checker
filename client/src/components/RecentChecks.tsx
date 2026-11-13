import { useEffect, useState } from "react";
import { api, getCheckStatus, type RecentTest } from "../lib/api";
import { ExternalIcon } from "./Icons";

const SHOW_AT_FIRST = 5;

interface RecentChecksProps {
  /** Change this number to load the list again (e.g. after a new check is sent). */
  refreshKey: number;
}

/**
 * The latest tests in Mailgun, newest first, with a button to reopen each one's results.
 * Everyone using the page sees the same list, including tests made directly in the Mailgun
 * dashboard. Reading it uses no credits.
 */
export function RecentChecks({ refreshKey }: RecentChecksProps) {
  const [tests, setTests] = useState<RecentTest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [blockedLink, setBlockedLink] = useState<{ id: string; url: string } | null>(null);

  useEffect(() => {
    api<{ tests: RecentTest[] }>("GET", "/api/tests")
      .then(({ tests }) => {
        setTests(tests);
        setError(null);
      })
      .catch((err) => setError("Couldn’t load recent checks: " + err.message));
  }, [refreshKey]);

  async function open(test: RecentTest) {
    setRowError(null);
    setBlockedLink(null);
    setOpening(test.id);
    // Open the tab right away (while it still counts as a click, so pop-up blockers allow it),
    // then send it to the results once we have the link.
    const tab = window.open("", "_blank");
    try {
      const status = await getCheckStatus(test.id);
      if (!status.shareUrl) {
        throw new Error(
          status.complete
            ? "Mailgun couldn’t create a share link for this test. Find it in the Mailgun dashboard."
            : `Still running (${status.done} of ${status.total} clients done). Try again in a minute.`,
        );
      }
      if (tab) {
        tab.opener = null;
        tab.location.href = status.shareUrl;
      } else {
        setBlockedLink({ id: test.id, url: status.shareUrl }); // pop-ups blocked: show a link instead
      }
    } catch (err) {
      tab?.close();
      setRowError({ id: test.id, message: (err as Error).message });
    } finally {
      setOpening(null);
    }
  }

  const shown = showAll ? (tests ?? []) : (tests ?? []).slice(0, SHOW_AT_FIRST);

  return (
    <section aria-labelledby="recent-title" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <h2 id="recent-title" className="text-sm font-semibold">
        Recent checks
      </h2>

      {error && <p className="text-[13px] text-muted">{error}</p>}
      {!tests && !error && <p className="text-[13px] text-muted">Loading…</p>}
      {tests && !tests.length && <p className="text-[13px] text-muted">No checks yet.</p>}

      {shown.length > 0 && (
        <ul className="m-0 grid min-w-0 list-none grid-cols-[minmax(0,1fr)] gap-0.5 p-0">
          {shown.map((test) => (
            <li key={test.id} className="-mx-2 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium" title={test.subject}>
                    {test.subject}
                  </p>
                  <p className="text-xs text-muted" title={new Date(test.date * 1000).toLocaleString()}>
                    {timeAgo(test.date)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => open(test)}
                  disabled={opening === test.id}
                  aria-label={`Open results for ${test.subject}`}
                  title="Open results in Mailgun"
                  className="grid size-8 flex-none place-items-center rounded-lg border border-line bg-surface text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-default disabled:opacity-50"
                >
                  <ExternalIcon size={14} />
                </button>
              </div>
              {opening === test.id && <p className="text-xs text-muted">Opening…</p>}
              {rowError?.id === test.id && <p className="text-xs text-fail">{rowError.message}</p>}
              {blockedLink?.id === test.id && (
                <p className="text-xs text-muted">
                  Pop-up blocked.{" "}
                  <a href={blockedLink.url} target="_blank" rel="noopener" className="font-semibold text-brand underline">
                    Open the results
                  </a>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {tests && tests.length > SHOW_AT_FIRST && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="justify-self-start border-0 bg-transparent p-0 text-[13px] font-semibold text-brand"
        >
          {showAll ? "Show fewer" : `Show all ${tests.length}`}
        </button>
      )}
    </section>
  );
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", or a date. */
function timeAgo(unixSeconds: number) {
  const minutes = Math.round((Date.now() / 1000 - unixSeconds) / 60);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
