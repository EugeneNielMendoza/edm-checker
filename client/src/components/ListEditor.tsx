import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ClientList, MailgunClient } from "../lib/api";
import { Button } from "./Button";
import { inputClass } from "./fields";
import { AlertIcon } from "./Icons";

interface ListEditorProps {
  open: boolean;
  /** The list being edited, or null when creating a new one. */
  list: ClientList | null;
  loadClients: () => Promise<MailgunClient[]>;
  onSave: (id: string | null, body: { name: string; clients: string[] }) => Promise<void>;
  onClose: () => void;
}

/** Pop-up for creating or editing a shared client list. */
export function ListEditor({ open, list, loadClients, onSave, onClose }: ListEditorProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clients, setClients] = useState<MailgunClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Open/close the native <dialog>, and fill the form each time it opens.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (!open) {
      if (el.open) el.close();
      return;
    }
    setName(list?.name ?? "");
    setSearch("");
    setSelected(new Set(list?.clients ?? []));
    setError(null);
    if (!el.open) el.showModal();
    nameInput.current?.focus();
    loadClients()
      .then((all) => {
        setClients(all);
        // Drop clients Mailgun no longer offers, so saving the list cleans them out.
        const known = new Set(all.map((c) => c.id));
        setSelected((prev) => new Set([...prev].filter((id) => known.has(id))));
      })
      .catch((err) => setError("Couldn’t load clients from Mailgun: " + err.message));
  }, [open, list, loadClients]);

  // Clients grouped by category (Mobile, Desktop, Web...), keeping Mailgun's order.
  const groups = useMemo(() => {
    const byCategory = new Map<string, MailgunClient[]>();
    for (const c of clients ?? []) {
      if (!byCategory.has(c.category)) byCategory.set(c.category, []);
      byCategory.get(c.category)!.push(c);
    }
    return [...byCategory];
  }, [clients]);

  // Every search word must appear in the client's name, OS, category or ID.
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (c: MailgunClient) => {
    const text = `${c.client} ${c.os} ${c.category} ${c.id}`.toLowerCase();
    return words.every((w) => text.includes(w));
  };

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // "Select all" applies to the clients currently shown in that group; if they're all on, it turns them off.
  const toggleAll = (shown: MailgunClient[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const turnOn = shown.some((c) => !prev.has(c.id));
      for (const c of shown) {
        if (turnOn) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { name: name.trim(), clients: [...selected] };
    if (!body.name) return setError("Give the list a name.");
    if (!body.clients.length) return setError("Pick at least one email client.");
    setSaving(true);
    try {
      await onSave(list?.id ?? null, body);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="editor-title"
      className="max-h-[calc(100vh-48px)] w-[min(660px,calc(100vw-32px))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-dialog"
    >
      <form onSubmit={submit} className="flex max-h-[calc(100vh-48px)] flex-col">
        <header className="grid gap-3.5 border-b border-line px-6 pb-[18px] pt-[22px]">
          <h2 id="editor-title" className="text-[19px] font-bold">
            {list ? `Edit “${list.name}”` : "New client list"}
          </h2>
          <label className="grid gap-1.5 text-sm font-semibold">
            List name
            <input
              ref={nameInput}
              type="text"
              maxLength={60}
              autoComplete="off"
              required
              placeholder="e.g. APAC CHECKER"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Find a client
            <input
              type="text"
              autoComplete="off"
              placeholder="e.g. Outlook, iPhone, dark"
              className={inputClass}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </header>

        <div className="min-h-[200px] flex-1 overflow-auto px-6 pb-[18px] pt-1">
          {!clients && !error && <p className="text-[13px] text-muted">Loading clients from Mailgun…</p>}
          {groups.map(([category, all]) => {
            const shown = all.filter(matches);
            if (!shown.length) return null;
            return (
              <fieldset key={category} className="m-0 border-0 p-0 pt-4">
                <legend className="flex w-full items-baseline justify-between p-0 pb-1.5 text-xs font-bold uppercase tracking-[.06em] text-muted">
                  {category}
                  <button
                    type="button"
                    onClick={() => toggleAll(shown)}
                    className="border-0 bg-transparent p-0 text-xs font-semibold normal-case tracking-normal text-brand"
                  >
                    Select all
                  </button>
                </legend>
                {shown.map((c) => (
                  <label key={c.id} className="-mx-2 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-[7px] text-sm hover:bg-surface-2">
                    <input
                      type="checkbox"
                      className="m-0 size-4 accent-brand"
                      checked={selected.has(c.id)}
                      onChange={(e) => toggle(c.id, e.target.checked)}
                    />
                    <span>{c.client}</span>
                    <small className="ml-auto text-right text-muted">{c.os}</small>
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>

        {error && (
          <p
            role="alert"
            className="mx-6 mb-4 flex items-start gap-2.5 rounded-[10px] border border-fail-line bg-[color-mix(in_srgb,var(--fail)_8%,transparent)] px-3.5 py-3 text-sm [overflow-wrap:anywhere]"
          >
            <AlertIcon className="mt-0.5 flex-none text-fail" />
            <span>{error}</span>
          </p>
        )}

        <footer className="flex items-center gap-2.5 border-t border-line px-6 py-4">
          <span className="text-[13px] text-muted">{selected.size} selected</span>
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Save list
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
