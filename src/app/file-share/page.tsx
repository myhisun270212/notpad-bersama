import { FileShareStation } from "@/components/file-share-station";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function FileSharePage() {
  return (
    <main className="flex min-h-screen w-full flex-col items-center bg-zinc-50 py-10">
      <div className="w-full max-w-5xl px-4">
        <FileShareStation />
      </div>
    </main>
  );
}
