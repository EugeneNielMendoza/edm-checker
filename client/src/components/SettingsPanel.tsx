import { useEffect, type ReactNode } from "react";
import type { ClientList, MailgunClient } from "../lib/api";
import { Button } from "./Button";
import { inputClass } from "./fields";
import { ChevronDownIcon, EditIcon, PlusIcon, TrashIcon } from "./Icons";

interface SettingsPanelProps {
  busy: boolean;
  subject: string;
  onSubjectChange: (value: string) => void;
  previewOnly: boolean;
  onPreviewOnlyChange: (value: boolean) => void;
  lists: ClientList[];
  selectedList: ClientList | undefined;
  selectedId: string;
  onSelectList: (id: string) => void;
  listsError: string | null;
  clients: MailgunClient[] | null;
  loadClients: () => Promise<MailgunClient[]>;
  onNewList: () => void;
  onEditList: () => void;
  onDeleteList: () => void;
  /** Shown at the bottom of the panel, below a divider (e.g. recent checks). */
  footer?: ReactNode;
}

/** Left column: subject line, Preview only switch and the email client list. */
export function SettingsPanel(props: SettingsPanelProps) {
  const { busy, selectedList, loadClients } = props;

  // Client names are needed to describe the selected list ("Gmail App, iPhone 14 Pro, ... +12 more").
  useEffect(() => {
    if (selectedList) loadClients().catch(() => {});
  }, [selectedList, loadClients]);

  return (
    <aside
      aria-label="Check settings"
      className="flex min-w-0 flex-col gap-5 border-b border-line bg-surface px-4 py-5 md:sticky md:top-[60px] md:h-[calc(100vh-60px)] md:gap-[26px] md:self-start md:overflow-y-auto md:border-b-0 md:border-r md:p-6"
    >
      <div className="grid min-w-0 gap-2">
        <label htmlFor="subject" className="text-sm font-semibold">
          Subject line
        </label>
        <input
          id="subject"
          type="text"
          autoComplete="off"
          placeholder="Defaults to the file name"
          className={inputClass}
          value={props.subject}
          onChange={(e) => props.onSubjectChange(e.target.value)}
          disabled={busy}
        />
      </div>

      <PreviewOnlySwitch checked={props.previewOnly} onChange={props.onPreviewOnlyChange} disabled={busy} />

      {/* Dimmed in Preview only mode: nothing is sent to these clients. */}
      <div className={`grid min-w-0 gap-2 ${props.previewOnly ? "opacity-[.45]" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="list" className="text-sm font-semibold">
            Email clients
          </label>
          {selectedList && (
            <span className="rounded-full bg-chip-run px-[9px] py-0.5 text-xs font-semibold text-chip-run-ink">
              {selectedList.clients.length} client{selectedList.clients.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="relative">
          <select
            id="list"
            className={`${inputClass} cursor-pointer appearance-none pr-9`}
            value={props.selectedId}
            onChange={(e) => props.onSelectList(e.target.value)}
            disabled={busy}
          >
            {props.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
            <option value="">Mailgun default clients</option>
          </select>
          <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#7b8496]" />
        </div>
        <p className="min-h-[1.5em] text-[13px] text-muted [overflow-wrap:anywhere]">
          {props.listsError ?? describeList(selectedList, props.clients)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={props.onNewList} disabled={busy}>
            <PlusIcon /> New list
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onEditList} disabled={busy || !selectedList}>
            <EditIcon /> Edit
          </Button>
          <Button variant="danger" size="sm" onClick={props.onDeleteList} disabled={busy || !selectedList}>
            <TrashIcon /> Delete
          </Button>
        </div>
        <p className="text-[13px] text-muted">Lists are shared with everyone using this page.</p>
      </div>

      {props.footer && <div className="border-t border-line pt-5 md:pt-6">{props.footer}</div>}
    </aside>
  );
}

/** "Gmail App, iPhone 14 Pro, Outlook, Yahoo +6 more" */
function describeList(list: ClientList | undefined, clients: MailgunClient[] | null) {
  if (!list) return "Mailgun’s default set of clients.";
  if (!clients) return "";
  const nameById = new Map(clients.map((c) => [c.id, c.client]));
  const names = [...new Set(list.clients.map((id) => nameById.get(id) || id))];
  return names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4} more` : "");
}

interface SwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}

function PreviewOnlySwitch({ checked, onChange, disabled }: SwitchProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span
        aria-hidden="true"
        className={`relative mt-px h-[22px] w-[38px] flex-none rounded-full border transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand peer-disabled:opacity-50 ${
          checked ? "border-brand bg-brand" : "border-line bg-surface-2"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 size-4 rounded-full transition ${
            checked ? "translate-x-4 bg-brand-ink" : "bg-muted"
          }`}
        />
      </span>
      <span className="grid gap-0.5">
        <b className="text-sm font-semibold">Preview only</b>
        <span className="text-[13px] text-muted">Render the email without sending it to Mailgun. Uses no preview credits.</span>
      </span>
    </label>
  );
}
