import Link from "next/link";
import { CollaborativeNotepad } from "@/components/collaborative-notepad";
import { listNotes } from "@/lib/notes";

export default async function Home() {
  const notes = await listNotes();

  return (
    <main className="flex min-h-screen w-full flex-col items-center py-10">
      <div className="mb-6 flex w-full max-w-4xl justify-end px-4">
        <Link
          href="/file-share"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800"
        >
          Buka Berbagi Berkas
        </Link>
      </div>

      <CollaborativeNotepad initialNotes={notes} />
    </main>
  );
}
