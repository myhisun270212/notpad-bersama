"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initSocket, shutdownSocket } from "@/lib/socket/client";
import type { Note } from "@/types/note";
import type { Socket } from "socket.io-client";

const SAVE_DEBOUNCE_MS = 700;

const uniqueById = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
};

type Props = {
  initialNotes: Note[];
};

type BroadcastPayload = {
  id: string;
  title?: string;
  content?: string;
};

type NoteState = Note & {
  isSaving?: boolean;
};

export function CollaborativeNotepad({ initialNotes }: Props) {
  const [notes, setNotes] = useState<NoteState[]>(() => uniqueById(initialNotes));
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    initialNotes[0]?.id ?? null,
  );
  const [titleInput, setTitleInput] = useState<string>(
    initialNotes[0]?.title ?? "",
  );
  const [contentInput, setContentInput] = useState<string>(
    initialNotes[0]?.content ?? "",
  );
  const pendingPatchRef = useRef<Record<string, string>>({});
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const isInitialLoadRef = useRef(true);

  const notesList = useMemo(() => uniqueById(notes), [notes]);

  const selectedNote = useMemo(
    () => notesList.find((note) => note.id === selectedNoteId) ?? null,
    [notesList, selectedNoteId],
  );

  const markSaving = useCallback((id: string, saving: boolean) => {
    setNotes((prev) =>
      prev.map((note) =>
        note.id === id
          ? {
              ...note,
              isSaving: saving,
            }
          : note,
      ),
    );
  }, []);

  const applyIncomingUpdate = useCallback((payload: BroadcastPayload) => {
    setNotes((prev) =>
      prev.map((note) =>
        note.id === payload.id
          ? {
              ...note,
              title: payload.title ?? note.title,
              content: payload.content ?? note.content,
            }
          : note,
      ),
    );

    if (payload.id === selectedNoteId) {
      if (typeof payload.title === "string") {
        setTitleInput(payload.title);
      }
      if (typeof payload.content === "string") {
        setContentInput(payload.content);
      }
    }
  }, [selectedNoteId]);

  const schedulePersist = useCallback(
    (id: string, patch: Record<string, string>) => {
      pendingPatchRef.current = {
        ...pendingPatchRef.current,
        ...patch,
      };

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        const payload = pendingPatchRef.current;
        pendingPatchRef.current = {};

        if (Object.keys(payload).length === 0) {
          return;
        }

        try {
          markSaving(id, true);
          const response = await fetch(`/api/notes/${id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            throw new Error(`Gagal menyimpan catatan: ${response.status}`);
          }
        } catch (error) {
          // Hapus log error di client untuk produksi
        } finally {
          markSaving(id, false);
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [markSaving],
  );

  const broadcast = useCallback((event: string, payload: BroadcastPayload) => {
    if (!socketRef.current) {
      return;
    }
    socketRef.current.emit(event, payload);
  }, []);

  const handleSelectNote = useCallback(
    (note: Note) => {
      setSelectedNoteId(note.id);
      setTitleInput(note.title);
      setContentInput(note.content);
    },
    [],
  );

  const handleCreateNote = useCallback(async () => {
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "Catatan baru" }),
      });

      if (!response.ok) {
        throw new Error("Gagal membuat catatan baru");
      }

      const note: Note = await response.json();
      setNotes((prev) => [note, ...prev.filter((item) => item.id !== note.id)]);
      setSelectedNoteId(note.id);
      setTitleInput(note.title);
      setContentInput(note.content);
    } catch (error) {
      console.error(error);
      alert("Tidak dapat membuat catatan. Coba lagi.");
    }
  }, []);

  const handleDeleteNote = useCallback(async () => {
    if (!selectedNoteId) {
      return;
    }

    const confirmed = confirm("Hapus catatan ini?");
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/notes/${selectedNoteId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Gagal menghapus catatan");
      }

      setNotes((prev) => {
        const filtered = uniqueById(
          prev.filter((note) => note.id !== selectedNoteId),
        );
        const nextNote = filtered[0];

        if (nextNote) {
          setSelectedNoteId(nextNote.id);
          setTitleInput(nextNote.title);
          setContentInput(nextNote.content);
        } else {
          setSelectedNoteId(null);
          setTitleInput("");
          setContentInput("");
        }

        return filtered;
      });
    } catch (error) {
      console.error(error);
      alert("Tidak dapat menghapus catatan. Coba lagi.");
    }
  }, [selectedNoteId]);

  const handleTitleChange = useCallback(
    (value: string) => {
      if (!selectedNoteId) {
        return;
      }
      setTitleInput(value);
      setNotes((prev) =>
        prev.map((note) =>
          note.id === selectedNoteId
            ? {
                ...note,
                title: value,
              }
            : note,
        ),
      );
      broadcast("note:title", { id: selectedNoteId, title: value });
      schedulePersist(selectedNoteId, { title: value });
    },
    [broadcast, schedulePersist, selectedNoteId],
  );

  const handleContentChange = useCallback(
    (value: string) => {
      if (!selectedNoteId) {
        return;
      }
      setContentInput(value);
      setNotes((prev) =>
        prev.map((note) =>
          note.id === selectedNoteId
            ? {
                ...note,
                content: value,
              }
            : note,
        ),
      );
      broadcast("note:content", { id: selectedNoteId, content: value });
      schedulePersist(selectedNoteId, { content: value });
    },
    [broadcast, schedulePersist, selectedNoteId],
  );

  useEffect(() => {
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return;
    }
    if (selectedNote) {
      setTitleInput(selectedNote.title);
      setContentInput(selectedNote.content);
    }
  }, [selectedNote]);

  useEffect(() => {
    const socket = initSocket();
    socketRef.current = socket;

    const handleCreated = (note: Note) => {
      setNotes((prev) => {
        const exists = prev.some((item) => item.id === note.id);
        if (exists) {
          return prev.map((item) => (item.id === note.id ? note : item));
        }
        return [note, ...prev];
      });
    };

    const handleUpdated = (note: Note) => {
      applyIncomingUpdate(note);
    };

    const handleDeleted = ({ id }: { id: string }) => {
      setNotes((prev) => prev.filter((item) => item.id !== id));
      if (selectedNoteId === id) {
        setSelectedNoteId(null);
      }
    };

    const handleTitle = (payload: BroadcastPayload) => {
      applyIncomingUpdate(payload);
    };

    const handleContent = (payload: BroadcastPayload) => {
      applyIncomingUpdate(payload);
    };

    socket.on("note:created", handleCreated);
    socket.on("note:updated", handleUpdated);
    socket.on("note:deleted", handleDeleted);
    socket.on("note:title", handleTitle);
    socket.on("note:content", handleContent);

    return () => {
      socket.off("note:created", handleCreated);
      socket.off("note:updated", handleUpdated);
      socket.off("note:deleted", handleDeleted);
      socket.off("note:title", handleTitle);
      socket.off("note:content", handleContent);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      shutdownSocket();
    };
  }, [applyIncomingUpdate, selectedNoteId]);

  return (
    <div className="flex h-[calc(100vh-80px)] w-full max-w-6xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <aside className="flex w-72 flex-col border-r border-zinc-200 bg-zinc-50">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
            Catatan Tersimpan
          </h2>
          <button
            type="button"
            onClick={handleCreateNote}
            className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800"
          >
            Catatan Baru
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notesList.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-500">
              Belum ada catatan. Buat satu untuk memulai.
            </p>
          ) : (
            <ul className="space-y-1 px-3 py-4">
              {notesList.map((note) => {
                const isActive = note.id === selectedNoteId;
                return (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectNote(note)}
                      className={`w-full rounded-xl px-3 py-2 text-left transition ${
                        isActive
                          ? "bg-black text-white"
                          : "bg-white text-zinc-700 hover:bg-zinc-100"
                      }`}
                    >
                      <p className="text-sm font-semibold line-clamp-1">
                        {note.title || "(Tanpa judul)"}
                      </p>
                      <p
                        className={`mt-1 text-xs line-clamp-2 ${
                          isActive ? "text-zinc-200" : "text-zinc-500"
                        }`}
                      >
                        {note.content ? note.content.slice(0, 80) : ""}
                        {note.content && note.content.length > 80 ? "…" : ""}
                      </p>
                      <p
                        className={`mt-2 text-[10px] uppercase tracking-wide ${
                          isActive ? "text-zinc-300" : "text-zinc-400"
                        }`}
                      >
                        {note.isSaving ? "Menyimpan…" : "Tersimpan"}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
      <section className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
          <div className="flex flex-col">
            <p className="text-xs uppercase tracking-widest text-zinc-400">
              Notpad Bersama
            </p>
            <h1 className="text-2xl font-semibold text-zinc-900">
              Satu catatan, banyak pikiran
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleDeleteNote}
              disabled={!selectedNoteId}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Hapus Catatan
            </button>
          </div>
        </header>
        {selectedNoteId ? (
          <div className="flex flex-1 flex-col gap-4 p-6">
            <input
              type="text"
              value={titleInput}
              onChange={(event) => handleTitleChange(event.target.value)}
              className="w-full rounded-xl border border-zinc-200 px-4 py-3 text-lg font-semibold text-zinc-900 outline-none transition focus:border-black focus:ring-4 focus:ring-black/10"
              placeholder="Judul catatan"
            />
            <textarea
              value={contentInput}
              onChange={(event) => handleContentChange(event.target.value)}
              className="h-full min-h-[360px] w-full flex-1 resize-none rounded-xl border border-zinc-200 p-4 text-base leading-relaxed text-zinc-800 outline-none transition focus:border-black focus:ring-4 focus:ring-black/10"
              placeholder="Tulis isi catatan di sini…"
            />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center text-zinc-500">
            <p className="text-lg font-medium">
              Pilih atau buat catatan baru untuk mulai menulis bersama.
            </p>
            <button
              type="button"
              onClick={handleCreateNote}
              className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
            >
              Buat Catatan
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default CollaborativeNotepad;
