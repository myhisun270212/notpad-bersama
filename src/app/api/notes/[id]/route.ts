import { NextResponse } from "next/server";
import { deleteNote, getNote, updateNote } from "@/lib/notes";
import { getIO, hasIO } from "@/lib/socket/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).pathname.split('/').pop() || '';
  try {
    const note = await getNote(id);

    if (!note) {
      return NextResponse.json(
        { message: "Catatan tidak ditemukan" },
        { status: 404 },
      );
    }

    return NextResponse.json(note);
  } catch (error) {
    console.error("GET /notes/:id failed", id, error);
    return NextResponse.json(
      { message: "Tidak dapat mengambil catatan" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const id = new URL(request.url).pathname.split('/').pop() || '';
  try {
    const body = await request.json().catch(() => ({}));
    const title = typeof body.title === "string" ? body.title : undefined;
    const content = typeof body.content === "string" ? body.content : undefined;

    if (title === undefined && content === undefined) {
      return NextResponse.json(
        { message: "Tidak ada data untuk diperbarui" },
        { status: 400 },
      );
    }

    const existingNote = await getNote(id);
    if (!existingNote) {
      return NextResponse.json(
        { message: "Catatan tidak ditemukan" },
        { status: 404 },
      );
    }

    const updated = await updateNote({
      id,
      title,
      content,
    });

    if (hasIO()) {
      try {
        const io = getIO();
        if (io) io.emit("note:updated", updated);
      } catch (err) {
        console.error("Socket emit failed", err);
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("PATCH /notes/:id failed", id, error);
    return NextResponse.json(
      { message: "Tidak dapat memperbarui catatan" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).pathname.split('/').pop() || '';
  try {
    const existingNote = await getNote(id);
    if (!existingNote) {
      return NextResponse.json(
        { message: "Catatan tidak ditemukan" },
        { status: 404 },
      );
    }

    await deleteNote(id);

    if (hasIO()) {
      try {
        const io = getIO();
        if (io) io.emit("note:deleted", { id });
      } catch (err) {
        console.error("Socket emit failed", err);
      }
    }

    return NextResponse.json({ message: "Catatan dihapus" });
  } catch (error) {
    console.error("DELETE /notes/:id failed", id, error);
    return NextResponse.json(
      { message: "Tidak dapat menghapus catatan" },
      { status: 500 },
    );
  }
}
