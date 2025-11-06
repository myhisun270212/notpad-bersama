import { NextResponse } from "next/server";
import { createNote, listNotes } from "@/lib/notes";
import { getIO, hasIO } from "@/lib/socket/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const notes = await listNotes();
    return NextResponse.json(notes);
  } catch (error) {
    console.error("Failed to fetch notes", error);
    return NextResponse.json(
      { message: "Tidak dapat mengambil daftar catatan" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const title = typeof body.title === "string" && body.title.trim() !== "" ? body.title : "Catatan baru";
    const content = typeof body.content === "string" ? body.content : "";

    const note = await createNote({ title, content });

    if (hasIO()) {
      const io = getIO();
      io.emit("note:created", note);
    }

    return NextResponse.json(note, { status: 201 });
  } catch (error) {
    console.error("Failed to create note", error);
    return NextResponse.json(
      { message: "Tidak dapat membuat catatan" },
      { status: 500 },
    );
  }
}
