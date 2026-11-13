// Talking to the server (lib/app.js). Every request goes to the same site the page came from.

export interface ClientList {
  id: string;
  name: string;
  clients: string[]; // Mailgun client IDs
}

export interface MailgunClient {
  id: string;
  client: string; // e.g. "Gmail App"
  os: string; // e.g. "Android 12"
  category: string; // e.g. "Mobile"
}

export interface Check {
  page: string;
  testId: string | null; // null in Preview only mode
  subject: string;
  warnings: Array<string | { message?: string; name?: string }>;
  html: string;
}

export interface CheckResponse {
  source: "template" | "export";
  preview?: boolean;
  checks: Check[];
}

export interface CheckStatus {
  total: number;
  done: number;
  failed: string[]; // names of clients that failed to render
  complete: boolean;
  shareUrl: string | null;
}

export interface RecentTest {
  id: string;
  subject: string;
  date: number; // Unix time in seconds
}

/** JSON request; throws an Error with the server's message if it fails. */
export async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Something went wrong (error ${res.status}).`);
  return data as T;
}

export const isHtmlFile = (name: string) => /\.html?$/i.test(name);

/** Uploads the zip/HTML file. The server renders it and (unless previewOnly) sends it to Mailgun. */
export async function uploadCheck(
  file: File,
  options: { subject: string; listId: string; previewOnly: boolean },
): Promise<CheckResponse> {
  const params = new URLSearchParams({ name: file.name, subject: options.subject, list: options.listId });
  if (options.previewOnly) params.set("preview", "1");
  const res = await fetch("/api/checks?" + params, {
    method: "POST",
    headers: { "Content-Type": isHtmlFile(file.name) ? "text/html" : "application/zip" },
    body: file,
  });
  const data = await res.json().catch(() => ({
    error:
      res.status === 413
        ? "That zip is too large to upload here."
        : res.status === 504
          ? "The server took too long. Try again."
          : `Upload failed (error ${res.status}).`,
  }));
  if (!res.ok) throw new Error(data.error || "Upload failed.");
  return data as CheckResponse;
}

/** Progress of one Mailgun test. */
export async function getCheckStatus(testId: string): Promise<CheckStatus> {
  const res = await fetch("/api/checks/" + encodeURIComponent(testId));
  const data = await res.json().catch(() => ({ error: `Checking progress failed (error ${res.status}).` }));
  if (!res.ok) throw new Error(data.error || "Checking progress failed.");
  return data as CheckStatus;
}
