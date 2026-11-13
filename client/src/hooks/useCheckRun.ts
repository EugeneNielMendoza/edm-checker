import { useCallback, useRef, useState } from "react";
import { getCheckStatus, isHtmlFile, uploadCheck, type Check, type ClientList } from "../lib/api";

// One check, from dropping the file to the Mailgun results:
//   1. Render     the server renders the template (or reads the exported email)
//   2. Send       the server sends it to Mailgun (skipped in Preview only mode)
//   3. Clients    we ask the server every 5 seconds how many email clients are done
//   4. Results    the Mailgun share link opens in a new tab

export type StepKey = "render" | "send" | "clients" | "ready";
export type StepState = "active" | "done" | "error" | "skipped";
export type ChipState = "running" | "done" | "warn" | "error";

export interface Step {
  label: string;
  state?: StepState; // undefined = not started
  detail?: string;
}

export interface PageResult {
  page: string;
  testId: string;
  total: number;
  failed: string[];
  shareUrl: string | null;
}

export interface Run {
  fileName: string;
  summary: string; // subject · client list
  eyebrow: string; // "Checking", "Check complete", ...
  chip: { state: ChipState; text: string };
  steps: Record<StepKey, Step>;
  progress: number; // 0–100
  results: PageResult[];
  notes: string[];
  popupBlocked: boolean;
  error: string | null;
  previewHtml: string | null;
  previewNote: string;
  pageCount: number;
  finished: boolean; // true once nothing else will happen (done, stopped or failed)
}

export interface StartOptions {
  subject: string;
  list: ClientList | undefined; // undefined = Mailgun's default clients
  previewOnly: boolean;
  maxUploadBytes: number;
}

const POLL_EVERY_MS = 5000;
const GIVE_UP_AFTER_MS = 15 * 60 * 1000;
const MB = 1048576;

function newRun(fileName: string, summary: string): Run {
  return {
    fileName,
    summary,
    eyebrow: "Checking",
    chip: { state: "running", text: "In progress" },
    steps: {
      render: { label: "Render" },
      send: { label: "Send to Mailgun" },
      clients: { label: "Email clients" },
      ready: { label: "Results" },
    },
    progress: 0,
    results: [],
    notes: [],
    popupBlocked: false,
    error: null,
    previewHtml: null,
    previewNote: "Sample data · 600px wide",
    pageCount: 1,
    finished: false,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useCheckRun() {
  const [run, setRun] = useState<Run | null>(null);
  // Each check gets a number. Starting a new check or resetting bumps it, so updates
  // still arriving from an older check are ignored and its polling stops.
  const currentRun = useRef(0);

  const reset = useCallback(() => {
    currentRun.current++;
    setRun(null);
  }, []);

  const start = useCallback(async (file: File, options: StartOptions) => {
    const id = ++currentRun.current;
    const isCurrent = () => currentRun.current === id;
    const update = (change: (r: Run) => Run) => setRun((r) => (r && isCurrent() ? change(r) : r));
    const setStep = (key: StepKey, state?: StepState, detail?: string) =>
      update((r) => ({
        ...r,
        steps: { ...r.steps, [key]: { ...r.steps[key], state, ...(detail !== undefined && { detail }) } },
      }));
    const addNote = (text: string) => update((r) => ({ ...r, notes: [...r.notes, text] }));
    const fail = (message: string) =>
      update((r) => ({ ...r, error: message, eyebrow: "Check stopped", chip: { state: "error", text: "Error" }, finished: true }));

    const { subject, list, previewOnly, maxUploadBytes } = options;
    const clientsText = previewOnly
      ? "Preview only, not sent to Mailgun"
      : list
        ? `${list.name} (${list.clients.length} clients)`
        : "Mailgun default clients";
    setRun(newRun(file.name, `${subject.trim() || "Subject: file name"} · ${clientsText}`));

    // ---- Quick checks before uploading ----
    if (!/\.(zip|html?)$/i.test(file.name)) {
      return fail("That isn’t a zip or HTML file. Drop a Sesimi template zip, or an email exported from Sesimi.");
    }
    if (maxUploadBytes && file.size > maxUploadBytes) {
      return fail(`That zip is ${(file.size / MB).toFixed(1)} MB; the limit here is ${(maxUploadBytes / MB).toFixed(1)} MB.`);
    }

    // ---- 1. Upload: the server renders it and (unless Preview only) sends it to Mailgun ----
    setStep("render", "active", isHtmlFile(file.name) ? "Reading the exported email" : "Reading the zip");
    let data;
    try {
      data = await uploadCheck(file, { subject, listId: list?.id ?? "", previewOnly });
    } catch (err) {
      setStep("render", "error", "Failed");
      return fail((err as Error).message);
    }

    const first = data.checks[0];
    const pageCount = data.checks.length;
    const isExport = data.source === "export";
    const renderDetail = isExport ? "Used as-is" : pageCount > 1 ? `${pageCount} pages` : "Done";
    update((r) => ({
      ...r,
      pageCount,
      previewHtml: first.html,
      previewNote: isExport ? "As exported · 600px wide" : "Sample data · 600px wide",
      steps: { ...r.steps, render: { label: isExport ? "Exported email" : "Render", state: "done", detail: renderDetail } },
    }));

    if (data.preview) {
      setStep("send", "skipped", "Skipped (preview only)");
      setStep("clients", "skipped", "Skipped");
      setStep("ready", "done", "Preview ready");
      addNote(
        `${isExport ? "Exported email shown as-is." : "Rendered only."} Nothing was sent to Mailgun.` +
          (pageCount > 1 ? ` Showing page ${first.page} of ${pageCount}.` : "") +
          " Turn off “Preview only” to test it in email clients.",
      );
      update((r) => ({ ...r, progress: 100, eyebrow: "Preview ready", chip: { state: "done", text: "Preview" }, finished: true }));
      return;
    }

    // ---- 2. Sent to Mailgun ----
    setStep("send", "done", first.subject);
    if (first.warnings.length) {
      addNote("Mailgun warnings: " + first.warnings.map((w) => (typeof w === "string" ? w : w.message || w.name)).join("; "));
    }

    // ---- 3 + 4. Wait for the email clients, then show and open the results ----
    // With several pages there is one Mailgun test per page; the first one drives the steps.
    const poll = async (check: Check, drivesSteps: boolean) => {
      const testId = check.testId!;
      if (drivesSteps) setStep("clients", "active", "Waiting for Mailgun");
      const startedAt = Date.now();
      while (Date.now() - startedAt < GIVE_UP_AFTER_MS) {
        await sleep(POLL_EVERY_MS);
        if (!isCurrent()) return;
        let status;
        try {
          status = await getCheckStatus(testId);
        } catch (err) {
          if (drivesSteps) setStep("clients", "error", "Failed");
          return fail((err as Error).message || "Lost contact with the server while checking progress.");
        }
        if (drivesSteps && status.total) {
          setStep("clients", "active", `${status.done} of ${status.total} rendered`);
          update((r) => ({ ...r, progress: Math.round((status.done / status.total) * 100) }));
        }
        if (status.complete) {
          const failed = status.failed;
          if (drivesSteps) {
            setStep("clients", "done", `${status.total} clients`);
            setStep("ready", "done", failed.length ? `${failed.length} failed` : "All rendered");
            update((r) => ({
              ...r,
              eyebrow: "Check complete",
              chip: failed.length ? { state: "warn", text: `${failed.length} failed` } : { state: "done", text: "Complete" },
            }));
          }
          // Open the results in a new tab. Browsers block this unless pop-ups are allowed for
          // this site. (No "noopener" feature: with it, window.open returns null even on success.)
          let blocked = false;
          if (status.shareUrl) {
            const opened = window.open(status.shareUrl, "_blank");
            if (opened) opened.opener = null;
            else blocked = true;
          }
          update((r) => ({
            ...r,
            popupBlocked: r.popupBlocked || blocked,
            results: [...r.results, { page: check.page, testId, total: status.total, failed, shareUrl: status.shareUrl }],
          }));
          if (!status.shareUrl) addNote(`Find test ${testId} in the Mailgun dashboard (a share link couldn’t be created).`);
          return;
        }
      }
      if (drivesSteps) setStep("clients", "error", "Still running after 15 min");
      addNote(`Mailgun is still working on test ${testId}. Check it in the Mailgun dashboard.`);
    };

    await Promise.all(data.checks.map((check, i) => poll(check, i === 0)));
    update((r) => ({ ...r, finished: true }));
  }, []);

  return { run, start, reset, busy: !!run && !run.finished };
}
