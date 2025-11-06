import { supabaseServerClient } from "@/lib/supabase/server";
import type { Note } from "@/types/note";

export async function listNotes(): Promise<Note[]> {
  const supabase = supabaseServerClient();
  const { data, error } = await supabase
    .from("notes")
    .select("id, title, content, updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list notes: ${error.message}`);
  }

  return (data ?? []).map((note) => ({
    id: note.id,
    title: note.title ?? "",
    content: note.content ?? "",
    updated_at: note.updated_at,
  }));
}

export async function getNote(id: string): Promise<Note | null> {
  const supabase = supabaseServerClient();
  const { data, error } = await supabase
    .from("notes")
    .select("id, title, content, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch note: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    title: data.title ?? "",
    content: data.content ?? "",
    updated_at: data.updated_at,
  };
}

export async function createNote({
  title,
  content,
}: {
  title: string;
  content?: string;
}): Promise<Note> {
  const supabase = supabaseServerClient();
  const { data, error } = await supabase
    .from("notes")
    .insert({ title, content: content ?? "" })
    .select("id, title, content, updated_at")
    .single();

  if (error) {
    throw new Error(`Failed to create note: ${error.message}`);
  }

  return {
    id: data.id,
    title: data.title ?? "",
    content: data.content ?? "",
    updated_at: data.updated_at,
  };
}

export async function updateNote({
  id,
  title,
  content,
}: {
  id: string;
  title?: string;
  content?: string;
}): Promise<Note> {
  const supabase = supabaseServerClient();
  const updates: Record<string, string | undefined> = {};

  if (typeof title === "string") {
    updates.title = title;
  }

  if (typeof content === "string") {
    updates.content = content;
  }

  // Tambahkan ini untuk update timestamp
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("notes")
    .update(updates)
    .eq("id", id)
    .select("id, title, content, updated_at")
    .single();

  if (error) {
    throw new Error(`Failed to update note: ${error.message}`);
  }

  return {
    id: data.id,
    title: data.title ?? "",
    content: data.content ?? "",
    updated_at: data.updated_at,
  };
}

export async function deleteNote(id: string): Promise<void> {
  const supabase = supabaseServerClient();
  const { error } = await supabase.from("notes").delete().eq("id", id);

  if (error) {
    throw new Error(`Failed to delete note: ${error.message}`);
  }
}
