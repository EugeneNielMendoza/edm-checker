import { useCallback, useRef, useState } from "react";
import { api, type ClientList, type MailgunClient } from "../lib/api";
import { KEYS, storage } from "../lib/storage";

/**
 * The shared client lists (everyone using the page sees and edits the same ones),
 * which one is selected, and the full list of Mailgun email clients.
 */
export function useClientLists() {
  const [lists, setLists] = useState<ClientList[]>([]);
  const [selectedId, setSelectedId] = useState(""); // "" = Mailgun's default clients
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clients, setClients] = useState<MailgunClient[] | null>(null);
  const clientsRequest = useRef<Promise<MailgunClient[]> | null>(null);

  /** All Mailgun email clients. Loaded once, then reused. */
  const loadClients = useCallback(() => {
    if (!clientsRequest.current) {
      clientsRequest.current = api<{ clients: MailgunClient[] }>("GET", "/api/clients")
        .then(({ clients }) => {
          setClients(clients);
          return clients;
        })
        .catch((err) => {
          clientsRequest.current = null; // try again next time
          throw err;
        });
    }
    return clientsRequest.current;
  }, []);

  /**
   * Fetches the lists again. Selects `want` if given and it still exists; otherwise keeps the
   * current (or last used) list, falling back to the first list.
   */
  const reload = useCallback(async (want?: string) => {
    let next: ClientList[] = [];
    try {
      next = (await api<{ lists: ClientList[] }>("GET", "/api/lists")).lists;
      setLoadError(null);
    } catch (err) {
      setLoadError("Couldn’t load the client lists: " + (err as Error).message);
    }
    setLists(next);
    setSelectedId((current) => {
      const target = want || current || storage.get(KEYS.list) || "";
      const id = next.some((l) => l.id === target) ? target : (next[0]?.id ?? "");
      storage.set(KEYS.list, id);
      return id;
    });
  }, []);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    storage.set(KEYS.list, id);
  }, []);

  /** Creates a list (no id) or updates one, then selects it. */
  const save = useCallback(
    async (id: string | null, body: { name: string; clients: string[] }) => {
      const { list } = id
        ? await api<{ list: ClientList }>("PUT", "/api/lists/" + id, body)
        : await api<{ list: ClientList }>("POST", "/api/lists", body);
      await reload(list.id);
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await api("DELETE", "/api/lists/" + id);
      } finally {
        await reload();
      }
    },
    [reload],
  );

  const selected = lists.find((l) => l.id === selectedId);

  return { lists, selected, selectedId, select, reload, save, remove, loadError, clients, loadClients };
}
