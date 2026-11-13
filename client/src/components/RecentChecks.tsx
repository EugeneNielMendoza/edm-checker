import { useEffect, useState } from "react";
import { api, getCheckStatus, type RecentTest } from "../lib/api";
import { Button } from "./Button";
import { ExternalIcon } from "./Icons";

const SHOW_AT_FIRST = 8;

/**
 * The latest tests in Mailgun, newest first, with a button to reopen each one's results.
 * This includes tests made directly in the Mailgun dashboard. Reading them uses no credits.
 */
export function RecentChecks() {
  const [tests, setTests] = useState<RecentTest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [blockedLink, setBlockedLink] = useState<{ id: string; url: string } | null>(null);

  useEffect(() => {
    api<{ tests: RecentTest[] }>("GET", "/api/tests")
      .then(({ tests }) => setTests(tests))
      .catch((err) => setError("Couldn’t load recent checks: " + err.message));
  }, []);

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

  if (error) return <p className="text-[13px] text-muted">{error}</p>;
  if (!tests) return <p className="text-[13px] text-muted">Loading recent checks…</p>;
  if (!tests.length) return null;

  const shown = showAll ? tests : tests.slice(0, SHOW_AT_FIRST);
  return (
    <section aria-labelledby="recent-title" className="w-full max-w-[640px] rounded-card border border-line bg-surface shadow-card">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-[18px] py-3">
        <h2 id="recent-title" className="text-sm font-semibold">
          Recent checks
        </h2>
        <span className="text-xs text-muted">From Mailgun · newest first</span>
      </div>
      <ul className="m-0 list-none divide-y divide-line p-0">
        {shown.map((test) => (
          <li key={test.id} className="grid gap-1.5 px-[18px] py-2.5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={test.subject}>
                  {test.subject}
                </p>
                <p className="text-xs text-muted" title={new Date(test.date * 1000).toLocaleString()}>
                  {timeAgo(test.date)}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => open(test)} disabled={opening === test.id}>
                <ExternalIcon size={13} />
                {opening === test.id ? "Opening…" : "Results"}
              </Button>
            </div>
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
      {tests.length > SHOW_AT_FIRST && (
        <div className="border-t border-line px-[18px] py-2.5">
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="border-0 bg-transparent p-0 text-[13px] font-semibold text-brand"
          >
            {showAll ? "Show fewer" : `Show all ${tests.length}`}
          </button>
        </div>
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
