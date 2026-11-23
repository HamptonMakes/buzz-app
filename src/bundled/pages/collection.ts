import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isTransientFailure, readErrorKind } from "../../features/relay/errors";
import { retryRead } from "../../features/relay/read-retry";
import {
  NOTE_KIND,
  NOTE_PAGE,
  noteKey,
  noteTag,
  parseNote,
  type Note,
} from "./model";
import type { NotesPage, NotesWorkspace } from "./workspace";
import { useLiveUpdatesInterrupted } from "./live-updates";

function cancelledRead(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    readErrorKind(error) === "cancelled"
  );
}

/** The Docs browser retains only the loaded, currently readable catalogue. */
export function useNotesCollection(workspace: NotesWorkspace) {
  const current = useRef<NotesPage>({ notes: [], more: false });
  const [collection, publish] = useState(current.current);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const liveInterrupted = useLiveUpdatesInterrupted(
    workspace.session.live,
    (channel) => collection.notes.some((note) => note.channel === channel),
  );
  const listing = useRef<AbortController | undefined>(undefined);
  const reading = useRef<AbortController | null>(null);
  const queued = useRef(new Map<string, Note>());
  const revoked = useRef(new Set<string>());
  const setCollection = useCallback(
    (change: (page: NotesPage) => NotesPage) => {
      current.current = change(current.current);
      publish(current.current);
    },
    [],
  );
  const cancelLoad = useCallback(() => {
    listing.current?.abort();
    setLoading(false);
  }, []);
  const remove = useCallback(
    (channels: readonly string[]) => {
      if (current.current.notes.some((note) => channels.includes(note.channel)))
        cancelLoad();
      for (const channel of channels) {
        revoked.current.add(channel);
        queued.current.delete(channel);
      }
      setCollection((old) => ({
        ...old,
        notes: old.notes.filter((note) => !channels.includes(note.channel)),
      }));
    },
    [cancelLoad, setCollection],
  );
  const changed = useCallback(
    (note: Note) => {
      if (revoked.current.has(note.channel)) return;
      const previous = current.current.notes.find(
        (item) => noteKey(item) === noteKey(note),
      );
      if (previous?.revision === note.revision) return;
      if (previous) cancelLoad();
      setCollection((old) => ({
        ...old,
        notes: [
          note,
          ...old.notes.filter((item) => noteKey(item) !== noteKey(note)),
        ],
      }));
    },
    [cancelLoad, setCollection],
  );
  const load = useCallback(
    async (more = false) => {
      listing.current?.abort();
      if (!more) {
        reading.current?.abort();
        reading.current = null;
        queued.current.clear();
      }
      const controller = new AbortController();
      listing.current = controller;
      setLoading(true);
      setError("");
      try {
        const page = await retryRead(
          async (signal) => {
            const result = await workspace.list(
              more ? current.current.cursor : undefined,
              signal,
            );
            // Discovery does not populate hidden-channel routes. Resolve this
            // page in one batch before retaining or following any content.
            const ids = [...new Set(result.notes.map((note) => note.channel))];
            if (ids.length)
              await workspace.session.channels.resolve?.(ids, {
                signal,
                consistency: "strong",
              });
            return result;
          },
          controller.signal,
          // Rosters and reconnects can retire a read while this view is still active.
          cancelledRead,
        );
        controller.signal.throwIfAborted();
        page.notes = page.notes.filter(
          (note) => !!workspace.session.channels.get?.(note.channel),
        );
        for (const note of page.notes) revoked.current.delete(note.channel);
        if (!more) setNeedsRefresh(false);
        setCollection((old) => ({
          ...page,
          notes: more
            ? [
                ...new Map(
                  [...old.notes, ...page.notes].map((note) => [
                    noteKey(note),
                    note,
                  ]),
                ).values(),
              ]
            : page.notes,
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!more && current.current.notes.length && isTransientFailure(error))
          setNeedsRefresh(true);
        else
          setError(
            cancelledRead(error)
              ? "Loading docs was interrupted."
              : error instanceof Error
                ? error.message
                : "Docs could not be read.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [workspace, setCollection],
  );
  useEffect(() => {
    void load();
    const queue = queued.current;
    return () => {
      listing.current?.abort();
      reading.current?.abort();
      reading.current = null;
      queue.clear();
    };
  }, [load]);
  const channels = [...new Set(collection.notes.map((note) => note.channel))]
    .sort()
    .join(":");
  const reconcile = useCallback(async () => {
    if (reading.current || !queued.current.size) return;
    const request = new AbortController();
    reading.current = request;
    const { signal } = request;
    try {
      // Replay can touch every loaded page. Admit one bounded background batch
      // at a time, while coalescing newer hints for addresses still queued.
      while (!signal.aborted && queued.current.size) {
        const batch = [...queued.current.values()].slice(0, 32);
        for (const note of batch) queued.current.delete(note.channel);
        const isCurrent = (before: Note) =>
          !revoked.current.has(before.channel) &&
          !queued.current.has(before.channel) &&
          current.current.notes.some(
            (note) =>
              noteKey(note) === noteKey(before) &&
              note.revision === before.revision,
          );
        try {
          const heads = new Map(
            (await workspace.reconcile(batch, signal)).map((head) => [
              noteKey(head),
              head,
            ]),
          );
          signal.throwIfAborted();
          for (const before of batch) {
            if (!isCurrent(before)) continue;
            const head = heads.get(noteKey(before));
            if (head) changed(head);
            else remove([before.channel]);
          }
        } catch (error) {
          if (signal.aborted) return;
          for (const before of batch) {
            if (!isCurrent(before)) continue;
            if (
              (isTransientFailure(error) || cancelledRead(error)) &&
              workspace.session.channels.get?.(before.channel)
            )
              setNeedsRefresh(true);
            else remove([before.channel]);
          }
        }
      }
    } finally {
      if (reading.current === request) reading.current = null;
    }
  }, [workspace, changed, remove]);
  useLayoutEffect(() => {
    if (!channels) return;
    const stop = workspace.session.artifacts.follow(
      channels.split(":"),
      (events) => {
        const known = new Map(
          current.current.notes.map((note) => [note.channel, note]),
        );
        for (const event of events) {
          const artifact = event.kind === NOTE_KIND;
          const channel = noteTag(event, artifact ? "h" : "d");
          if (!channel || revoked.current.has(channel)) continue;
          const note = known.get(channel);
          if (
            !note ||
            (artifact &&
              (note.revision === event.id || noteTag(event, "d") !== note.id))
          )
            continue;
          queued.current.set(channel, note);
        }
        queueMicrotask(() => void reconcile());
      },
      remove,
    );
    // Revocation may precede this subscription; follow reports future losses.
    const denied = channels
      .split(":")
      .filter((channel) => !workspace.session.channels.get?.(channel));
    if (denied.length) remove(denied);
    return stop;
  }, [workspace, channels, reconcile, remove]);
  const showRefresh =
    !error &&
    (needsRefresh ||
      (liveInterrupted && (!loading || collection.notes.length > 0)));
  return { collection, loading, error, showRefresh, load, changed, remove };
}

/** Resolve retained titles only when browsing Trash, in batches of exact revision IDs. */
export function useTrashTitles(
  workspace: NotesWorkspace,
  entries: readonly Note[],
  enabled: boolean,
) {
  const [titles, setTitles] = useState(
    () => new Map<string, string | undefined>(),
  );
  useEffect(() => {
    if (!enabled) return;
    const pending = entries.flatMap((note) => {
      const parent =
        note.deleted &&
        !titles.has(note.revision) &&
        noteTag(note.event, "prev");
      return parent ? [{ note, parent }] : [];
    });
    if (!pending.length) return;
    const controller = new AbortController();
    const read = async () => {
      const next = new Map(titles);
      for (let offset = 0; offset < pending.length; offset += NOTE_PAGE) {
        const batch = pending.slice(offset, offset + NOTE_PAGE);
        const events = await workspace.read(
          [
            {
              kinds: [NOTE_KIND],
              ids: batch.map(({ parent }) => parent),
              "#h": batch.map(({ note }) => note.channel),
              limit: batch.length,
            },
          ],
          controller.signal,
        );
        const byId = new Map(events.map((event) => [event.id, event]));
        for (const { note, parent } of batch) {
          const event = byId.get(parent);
          const retained = event && parseNote(event);
          next.set(
            note.revision,
            retained && !retained.deleted && noteKey(retained) === noteKey(note)
              ? retained.title
              : undefined,
          );
        }
      }
      controller.signal.throwIfAborted();
      setTitles(next);
    };
    void read().catch(() => {});
    return () => controller.abort();
  }, [enabled, entries, titles, workspace]);
  return titles;
}
