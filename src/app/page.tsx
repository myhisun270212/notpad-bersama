import { CollaborativeNotepad } from "@/components/collaborative-notepad";
import { listNotes } from "@/lib/notes";

export default async function Home() {
  const notes = await listNotes();

  return (
    <main className="flex min-h-screen w-full flex-col items-center py-10">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-semibold text-zinc-900">
          Notpad Bersama
        </h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-600">
          Tulis catatan bersama dalam jaringan yang sama. Perubahan realtime
          akan muncul di semua perangkat yang membuka halaman ini.
        </p>
      </header>
      <CollaborativeNotepad initialNotes={notes} />
    </main>
  );
}
