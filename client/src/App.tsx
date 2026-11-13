import { useEffect, useRef, useState } from "react";
import { DropZone } from "./components/DropZone";
import { EmailPreview } from "./components/EmailPreview";
import { ListEditor } from "./components/ListEditor";
import { RecentChecks } from "./components/RecentChecks";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatusCard } from "./components/StatusCard";
import { TopBar } from "./components/TopBar";
import { useCheckRun } from "./hooks/useCheckRun";
import { useClientLists } from "./hooks/useClientLists";
import { useIsDesktop } from "./hooks/useIsDesktop";
import { useTheme } from "./hooks/useTheme";
import type { ClientList } from "./lib/api";
import { KEYS, storage } from "./lib/storage";

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const lists = useClientLists();
  const { run, start, reset, busy } = useCheckRun();

  const [subject, setSubject] = useState("");
  const [previewOnly, setPreviewOnly] = useState(() => storage.get(KEYS.previewOnly) === "1");
  const [maxUploadBytes, setMaxUploadBytes] = useState(0);
  const [editor, setEditor] = useState<{ open: boolean; list: ClientList | null }>({ open: false, list: null });
  const [dragOver, setDragOver] = useState(false);
  const isDesktop = useIsDesktop();

  // Reload "Recent checks" once a new test has been sent to Mailgun, so it appears at the top.
  const [recentKey, setRecentKey] = useState(0);
  const sentToMailgun = run?.steps.send.state === "done";
  useEffect(() => {
    if (sentToMailgun) setRecentKey((k) => k + 1);
  }, [sentToMailgun]);
  // In the left panel on desktop; below the main area on phones (so the drop box comes first).
  const recentChecks = <RecentChecks refreshKey={recentKey} />;

  // On first load: the upload size limit, and the shared client lists.
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => setMaxUploadBytes(c.maxUploadBytes || 0))
      .catch(() => {});
    lists.reload();
  }, []);

  function changePreviewOnly(value: boolean) {
    setPreviewOnly(value);
    storage.set(KEYS.previewOnly, value ? "1" : "0");
  }

  function startCheck(file: File) {
    if (busy) return;
    start(file, { subject, list: lists.selected, previewOnly, maxUploadBytes });
  }

  async function deleteList() {
    const list = lists.selected;
    if (!list) return;
    if (!confirm(`Delete the list “${list.name}” for everyone? This can’t be undone.`)) return;
    try {
      await lists.remove(list.id);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  // Files can be dropped anywhere on the page (not just on the drop box) while no check is running.
  // The listeners are added once, so they read the latest values through this ref.
  const latest = useRef({ busy, editorOpen: editor.open, startCheck });
  latest.current = { busy, editorOpen: editor.open, startCheck };
  useEffect(() => {
    let depth = 0; // dragenter/dragleave fire for every element crossed, so count them
    const onEnter = (e: DragEvent) => {
      e.preventDefault();
      if (latest.current.busy) return;
      depth++;
      setDragOver(true);
    };
    const onLeave = () => {
      if (--depth <= 0) {
        depth = 0;
        setDragOver(false);
      }
    };
    const onOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragOver(false);
      const file = e.dataTransfer?.files[0];
      if (file && !latest.current.busy && !latest.current.editorOpen) latest.current.startCheck(file);
    };
    document.addEventListener("dragenter", onEnter);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("dragover", onOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr]">
      <TopBar theme={theme} onToggleTheme={toggleTheme} />

      <div className="grid min-h-0 grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)]">
        <SettingsPanel
          busy={busy}
          subject={subject}
          onSubjectChange={setSubject}
          previewOnly={previewOnly}
          onPreviewOnlyChange={changePreviewOnly}
          lists={lists.lists}
          selectedList={lists.selected}
          selectedId={lists.selectedId}
          onSelectList={lists.select}
          listsError={lists.loadError}
          clients={lists.clients}
          loadClients={lists.loadClients}
          onNewList={() => setEditor({ open: true, list: null })}
          onEditList={() => lists.selected && setEditor({ open: true, list: lists.selected })}
          onDeleteList={deleteList}
          footer={isDesktop ? recentChecks : undefined}
        />

        <main className="flex min-w-0 flex-col px-4 py-5 md:p-8">
          {run ? (
            <section aria-live="polite" className="mx-auto grid w-full max-w-[980px] gap-5">
              <StatusCard run={run} onCheckAnother={reset} />
              {run.previewHtml && <EmailPreview html={run.previewHtml} note={run.previewNote} />}
            </section>
          ) : (
            <DropZone dragOver={dragOver} maxUploadBytes={maxUploadBytes} onFile={startCheck} />
          )}
          {!isDesktop && <div className="mt-8 border-t border-line pt-6">{recentChecks}</div>}
        </main>
      </div>

      <ListEditor
        open={editor.open}
        list={editor.list}
        loadClients={lists.loadClients}
        onSave={lists.save}
        onClose={() => setEditor((e) => ({ ...e, open: false }))}
      />
    </div>
  );
}
