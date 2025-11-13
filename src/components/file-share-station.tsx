"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { connectFileShareSocket } from "@/lib/socket/file-share-client";

type Mode = "send" | "receive";

type TransferMeta = {
  transferId: string;
  name: string;
  size: number;
  type: string;
  relativePath?: string;
  totalChunks: number;
};

type IncomingTransfer = {
  meta: TransferMeta;
  receivedBytes: number;
  receivedChunks: number;
  status: "pending" | "receiving" | "complete" | "error";
  errorMessage?: string;
  downloadUrl?: string;
  blob?: Blob;
};

type OutgoingTransfer = {
  meta: TransferMeta;
  sentChunks: number;
  status: "pending" | "sending" | "complete" | "error";
  errorMessage?: string;
};

type FileMetaPayload = TransferMeta & {
  roomId: string;
};

type QueuedFile = {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  relativePath?: string;
};

const FILE_CHUNK_SIZE = 512 * 1024; // 512 KB per chunk to balance throughput & memory

const ensureEndpoint = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return undefined;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return `http://${trimmed}`;
};

const getCrypto = () => (typeof globalThis !== "undefined" ? globalThis.crypto : undefined);

const generateHexId = (byteLength = 16) => {
  const cryptoRef = getCrypto();
  const buffer = new Uint8Array(byteLength);

  if (cryptoRef?.getRandomValues) {
    cryptoRef.getRandomValues(buffer);
  } else {
    for (let index = 0; index < buffer.length; index += 1) {
      buffer[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const generateRoomId = () => generateHexId(4);
const generateTransferId = () => generateHexId(16);

const downloadFolderAsZip = async (folderName: string, files: IncomingTransfer[]) => {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  files.forEach((transfer) => {
    if (!transfer.blob) {
      return;
    }

    const relativePath = transfer.meta.relativePath ?? transfer.meta.name;
    zip.file(relativePath, transfer.blob);
  });

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${folderName}.zip`;
  anchor.rel = "noopener";
  anchor.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 5_000);
};

export function FileShareStation() {
  const [mode, setMode] = useState<Mode>("send");
  const [ipAddress, setIpAddress] = useState("");
  const [roomId, setRoomId] = useState(() => generateRoomId());
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "connecting" | "connected" | "error"
  >("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const [outgoingFiles, setOutgoingFiles] = useState<OutgoingTransfer[]>([]);
  const [incomingFiles, setIncomingFiles] = useState<IncomingTransfer[]>([]);
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [folderActionMessage, setFolderActionMessage] = useState<string | null>(null);
  const [processingFolder, setProcessingFolder] = useState<string | null>(null);
  const incomingBuffers = useRef(new Map<string, (BlobPart | undefined)[]>());
  const downloadUrlsRef = useRef(new Set<string>());
  const socketRef = useRef<Socket | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const effectiveRoomId = roomId.trim();
  const canConnect = effectiveRoomId.length > 0;

  const connectionHint = useMemo(() => {
    if (mode === "send") {
      return "Masukkan alamat IP perangkat penerima atau biarkan kosong jika menggunakan perangkat yang menjalankan aplikasi ini.";
    }
    return "Masukkan alamat IP perangkat pengirim atau biarkan kosong jika berada pada server yang sama.";
  }, [mode]);

  const disconnectSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  const resetTransfers = useCallback(() => {
    setOutgoingFiles([]);
    setIncomingFiles((prev) => {
      prev.forEach((item) => {
        if (item.downloadUrl) {
          URL.revokeObjectURL(item.downloadUrl);
          downloadUrlsRef.current.delete(item.downloadUrl);
        }
      });
      return [];
    });
    setQueuedFiles([]);
    setFolderActionMessage(null);
    setProcessingFolder(null);
    incomingBuffers.current.clear();
  }, []);

  const handleConnect = useCallback(() => {
    if (!canConnect) {
      setConnectionStatus("error");
      setConnectionError("Room ID wajib diisi.");
      return;
    }

    setConnectionStatus("connecting");
    setConnectionError(null);

    disconnectSocket();
    resetTransfers();

    try {
      const endpoint = ensureEndpoint(ipAddress);
      const socket = connectFileShareSocket({ endpoint });
      socketRef.current = socket;

      socket.on("connect", () => {
        setConnectionStatus("connected");
        socket.emit("room:join", { roomId: effectiveRoomId });
      });

      socket.on("connect_error", (error) => {
        setConnectionStatus("error");
        setConnectionError(error.message ?? "Gagal menghubungkan ke server.");
      });

      socket.on("room:joined", () => {
        setConnectionError(null);
      });

      socket.on("peer:joined", () => {
        setConnectionError(null);
      });

      socket.on("peer:left", () => {
        // Dibiarkan untuk memberi tahu pengguna jika perlu menunggu ulang.
      });

      socket.on("file:meta", (payload: FileMetaPayload) => {
        const { roomId: _roomId, ...meta } = payload;
        incomingBuffers.current.set(meta.transferId, new Array(meta.totalChunks));
        setIncomingFiles((prev) => {
          const withoutExisting = prev.filter((item) => item.meta.transferId !== meta.transferId);
          return [
            ...withoutExisting,
            {
              meta,
              receivedBytes: 0,
              receivedChunks: 0,
              status: "pending",
            },
          ];
        });
      });

      socket.on(
        "file:chunk",
        (payload: {
          roomId: string;
          transferId: string;
          chunkIndex: number;
          chunk: ArrayBuffer;
        }) => {
          const buffers = incomingBuffers.current.get(payload.transferId);
          if (!buffers) {
            return;
          }

          buffers[payload.chunkIndex] = payload.chunk;

          setIncomingFiles((prev) =>
            prev.map((incoming) => {
              if (incoming.meta.transferId !== payload.transferId) {
                return incoming;
              }

              const receivedBytes = incoming.receivedBytes + payload.chunk.byteLength;
              const receivedChunks = incoming.receivedChunks + 1;

              return {
                ...incoming,
                receivedBytes,
                receivedChunks,
                status: "receiving",
              };
            }),
          );
        },
      );

      socket.on("file:complete", (payload: { roomId: string; transferId: string }) => {
        const buffers = incomingBuffers.current.get(payload.transferId);
        if (!buffers) {
          return;
        }

        const orderedChunks = buffers.filter((chunk): chunk is BlobPart => Boolean(chunk));
        const blob = new Blob(orderedChunks, { type: "application/octet-stream" });
        const downloadUrl = URL.createObjectURL(blob);
        downloadUrlsRef.current.add(downloadUrl);

        setIncomingFiles((prev) =>
          prev.map((item) =>
            item.meta.transferId === payload.transferId
              ? {
                  ...item,
                  status: "complete",
                  receivedBytes: item.meta.size,
                  receivedChunks: item.meta.totalChunks,
                  downloadUrl,
                  blob,
                }
              : item,
          ),
        );

        incomingBuffers.current.delete(payload.transferId);
      });

      socket.on(
        "file:error",
        (payload: { roomId: string; transferId: string; message?: string }) => {
          setIncomingFiles((prev) =>
            prev.map((incoming) =>
              incoming.meta.transferId === payload.transferId
                ? {
                    ...incoming,
                    status: "error",
                    errorMessage: payload.message ?? "Terjadi kesalahan saat menerima berkas.",
                  }
                : incoming,
            ),
          );

          incomingBuffers.current.delete(payload.transferId);
        },
      );

      socket.on("disconnect", () => {
        setConnectionStatus("idle");
      });
    } catch (error) {
      setConnectionStatus("error");
      setConnectionError(error instanceof Error ? error.message : "Gagal menyiapkan koneksi.");
    }
  }, [canConnect, disconnectSocket, effectiveRoomId, ipAddress, resetTransfers]);

  useEffect(() => {
    return () => {
      downloadUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      downloadUrlsRef.current.clear();
      disconnectSocket();
    };
  }, [disconnectSocket]);

  const handleGenerateRoomId = useCallback(() => {
    setRoomId(generateRoomId());
  }, []);

  const triggerFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const triggerFolderPicker = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  const enqueueFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const files = Array.from(fileList);
    const excludePatterns = [
      'node_modules/',
      '.git/',
      '.next/',
      'dist/',
      'build/',
      '.cache/',
      'coverage/',
      '.nyc_output/',
      'logs/',
      '*.log',
      '.DS_Store',
      'Thumbs.db'
    ];

    const filtered = files.filter((file) => {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      return !excludePatterns.some(pattern => {
        if (pattern.endsWith('/')) {
          return relativePath.includes(pattern);
        }
        if (pattern.startsWith('*.')) {
          return relativePath.endsWith(pattern.slice(1));
        }
        return relativePath.includes(pattern);
      });
    });

    if (filtered.length !== files.length) {
      setFolderActionMessage(`Disaring ${files.length - filtered.length} berkas (node_modules, .git, dll)`);
    }

    const queued = filtered.map((file) => {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      return {
        id: generateHexId(6),
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        relativePath: relativePath && relativePath.length > 0 ? relativePath : undefined,
      } satisfies QueuedFile;
    });

    setQueuedFiles((prev) => [...prev, ...queued]);
  }, []);

  const handleSendQueuedFiles = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket || connectionStatus !== "connected") {
      setConnectionError("Hubungkan dulu sebelum mengirim.");
      return;
    }

    if (queuedFiles.length === 0) {
      return;
    }

    // Send up to 3 files in parallel for better performance
    const PARALLEL_LIMIT = 3;
    const sendFile = async (queued: QueuedFile) => {
      const { file, relativePath } = queued;
      const transferId = generateTransferId();
      const totalChunks = Math.ceil(file.size / FILE_CHUNK_SIZE) || 1;
      const meta: TransferMeta = {
        transferId,
        name: file.name,
        size: file.size,
        type: file.type,
        relativePath,
        totalChunks,
      };

      setOutgoingFiles((prev) => [
        ...prev.filter((item) => item.meta.transferId !== transferId),
        {
          meta,
          sentChunks: 0,
          status: "pending",
        },
      ]);

      socket.emit("file:meta", { ...meta, roomId: effectiveRoomId });

      try {
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
          const start = chunkIndex * FILE_CHUNK_SIZE;
          const end = Math.min(start + FILE_CHUNK_SIZE, file.size);
          const blob = file.slice(start, end);
          const chunkBuffer = await blob.arrayBuffer();

          socket.emit("file:chunk", {
            roomId: effectiveRoomId,
            transferId,
            chunkIndex,
            chunk: chunkBuffer,
          });

          setOutgoingFiles((prev) =>
            prev.map((item) =>
              item.meta.transferId === transferId
                ? { ...item, sentChunks: chunkIndex + 1, status: "sending" }
                : item,
            ),
          );
        }

        socket.emit("file:complete", { roomId: effectiveRoomId, transferId });

        setOutgoingFiles((prev) =>
          prev.map((item) =>
            item.meta.transferId === transferId
              ? { ...item, status: "complete" }
              : item,
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Tidak dapat mengirim berkas.";
        socket.emit("file:error", { roomId: effectiveRoomId, transferId, message });
        setOutgoingFiles((prev) =>
          prev.map((item) =>
            item.meta.transferId === transferId
              ? { ...item, status: "error", errorMessage: message }
              : item,
          ),
        );
      } finally {
        setQueuedFiles((prev) => prev.filter((item) => item.id !== queued.id));
      }
    };

    // Process files in batches for parallel sending
    for (let i = 0; i < queuedFiles.length; i += PARALLEL_LIMIT) {
      const batch = queuedFiles.slice(i, i + PARALLEL_LIMIT);
      await Promise.all(batch.map(sendFile));
    }
  }, [connectionStatus, effectiveRoomId, queuedFiles]);

  const folderGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        folderName: string;
        files: IncomingTransfer[];
      }
    >();

    incomingFiles.forEach((transfer) => {
      const relativePath = transfer.meta.relativePath;
      if (!relativePath) {
        return;
      }

      const [rootFolder] = relativePath.split("/");
      if (!rootFolder) {
        return;
      }

      const existing = groups.get(rootFolder) ?? { folderName: rootFolder, files: [] };
      existing.files.push(transfer);
      groups.set(rootFolder, existing);
    });

    return Array.from(groups.values());
  }, [incomingFiles]);

  const handleSaveFolder = useCallback(
    async (folderName: string) => {
      const targetGroup = folderGroups.find((group) => group.folderName === folderName);
      if (!targetGroup) {
        setFolderActionMessage("Folder tidak ditemukan dalam antrian penerimaan.");
        return;
      }

      const incomplete = targetGroup.files.some(
        (file) => file.status !== "complete" || !file.blob,
      );

      if (incomplete) {
        setFolderActionMessage("Pastikan semua berkas dalam folder selesai diterima sebelum menyimpan.");
        return;
      }

      const hasDirectoryPicker = typeof window !== "undefined" && "showDirectoryPicker" in window;
      if (!hasDirectoryPicker) {
        try {
          setProcessingFolder(folderName);
          await downloadFolderAsZip(folderName, targetGroup.files);
          setFolderActionMessage(`Folder "${folderName}" dikemas sebagai arsip ZIP.`);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Gagal membuat arsip folder.";
          setFolderActionMessage(message);
        } finally {
          setProcessingFolder(null);
        }
        return;
      }

      try {
        setProcessingFolder(folderName);
        const directoryHandle = await (window as unknown as {
          showDirectoryPicker: (options?: unknown) => Promise<FileSystemDirectoryHandle>;
        }).showDirectoryPicker({ id: `receive-${folderName}` });

        for (const transfer of targetGroup.files) {
          const relativePath = transfer.meta.relativePath ?? transfer.meta.name;
          const segments = relativePath.split("/").filter(Boolean);
          const fileName = segments.pop() ?? transfer.meta.name;

          let currentDir = directoryHandle;
          for (const segment of segments) {
            currentDir = await currentDir.getDirectoryHandle(segment, { create: true });
          }

          const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(transfer.blob as Blob);
          await writable.close();
        }

        setFolderActionMessage(`Folder "${folderName}" berhasil disimpan.`);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setFolderActionMessage("Penyimpanan folder dibatalkan.");
          return;
        }

        const message = error instanceof Error ? error.message : "Gagal menyimpan folder.";
        setFolderActionMessage(message);
      } finally {
        setProcessingFolder(null);
      }
    },
    [folderGroups],
  );

  const connectionStatusLabel = useMemo(() => {
    switch (connectionStatus) {
      case "idle":
        return "Belum terhubung";
      case "connecting":
        return "Menghubungkan...";
      case "connected":
        return "Terhubung";
      case "error":
        return "Gagal terhubung";
      default:
        return "Tidak diketahui";
    }
  }, [connectionStatus]);

  return (
    <section className="w-full max-w-4xl space-y-8 rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900">Berbagi Berkas Lokal</h1>
        <p className="text-sm text-zinc-600">
          Sambungkan dua perangkat dalam jaringan yang sama. Gunakan Room ID yang sama pada pengirim dan
          penerima, lalu pilih berkas atau folder (hingga 2 GB) untuk dikirim.
        </p>
      </header>

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("send")}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              mode === "send"
                ? "bg-zinc-900 text-white hover:bg-zinc-800"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            Kirim
          </button>
          <button
            type="button"
            onClick={() => setMode("receive")}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              mode === "receive"
                ? "bg-zinc-900 text-white hover:bg-zinc-800"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            Terima
          </button>
        </div>
        <div className="text-sm text-zinc-500">Status: {connectionStatusLabel}</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium text-zinc-700">Alamat server (opsional)</span>
          <input
            type="text"
            value={ipAddress}
            onChange={(event) => setIpAddress(event.target.value)}
            placeholder="Misal: 192.168.1.10:3000 atau kosongkan"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-800 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
          <span className="text-xs text-zinc-500">{connectionHint}</span>
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium text-zinc-700">Room ID</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={roomId}
              onChange={(event) => setRoomId(event.target.value)}
              className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-800 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
            <button
              type="button"
              onClick={handleGenerateRoomId}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Acak
            </button>
          </div>
          <span className="text-xs text-zinc-500">
            Gunakan Room ID yang sama di kedua perangkat agar saling terhubung.
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          onClick={handleConnect}
          className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 md:w-auto"
        >
          Sambungkan
        </button>
        {connectionError ? <p className="text-sm text-red-600">{connectionError}</p> : null}
      </div>

      {mode === "send" ? (
        <div className="space-y-4">
          <div className="rounded-md border border-dashed border-zinc-300 p-6">
            <div className="flex flex-col gap-3 text-center">
              <span className="text-sm font-medium text-zinc-700">Pilih berkas atau folder</span>
              <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  onClick={triggerFilePicker}
                  className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 sm:w-auto"
                >
                  Pilih Berkas
                </button>
                <button
                  type="button"
                  onClick={triggerFolderPicker}
                  className="w-full rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100 sm:w-auto"
                >
                  Pilih Folder
                </button>
              </div>
              <span className="text-xs text-zinc-500">
                Dukung banyak berkas atau folder (hingga 2 GB total per berkas).
              </span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                enqueueFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <input
              ref={(element) => {
                if (element) {
                  element.setAttribute("webkitdirectory", "true");
                  element.setAttribute("directory", "true");
                }
                folderInputRef.current = element;
              }}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                enqueueFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-zinc-800">Antrian Berkas</h2>
              <button
                type="button"
                onClick={() => setQueuedFiles([])}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Bersihkan Antrian
              </button>
            </div>
            {queuedFiles.length === 0 ? (
              <p className="text-sm text-zinc-500">Belum ada berkas di antrian.</p>
            ) : (
              <>
                <ul className="space-y-2 text-sm">
                  {queuedFiles.map((queued) => (
                    <li key={queued.id} className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2">
                      <span className="text-zinc-800">
                        {queued.relativePath ?? queued.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQueuedFiles((prev) => prev.filter((item) => item.id !== queued.id))}
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        Hapus
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => void handleSendQueuedFiles()}
                  disabled={connectionStatus !== "connected" || queuedFiles.length === 0}
                  className={`w-full rounded-md px-4 py-2 text-sm font-semibold text-white transition ${
                    connectionStatus !== "connected" || queuedFiles.length === 0
                      ? "cursor-not-allowed bg-zinc-400"
                      : "bg-emerald-600 hover:bg-emerald-500"
                  }`}
                >
                  Mulai Kirim ({queuedFiles.length})
                </button>
              </>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-zinc-800">Progres Pengiriman</h2>
            {outgoingFiles.length === 0 ? (
              <p className="text-sm text-zinc-500">Belum ada berkas yang dikirim.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {outgoingFiles.map((transfer) => {
                  const progress = transfer.meta.totalChunks
                    ? Math.round((transfer.sentChunks / transfer.meta.totalChunks) * 100)
                    : 0;

                  return (
                    <li
                      key={transfer.meta.transferId}
                      className="rounded-md border border-zinc-200 p-3"
                    >
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-zinc-800">
                          {transfer.meta.relativePath ?? transfer.meta.name}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {transfer.status === "complete"
                            ? "Selesai dikirim"
                            : transfer.status === "error"
                              ? transfer.errorMessage ?? "Terjadi kesalahan"
                              : `Mengirim... ${progress}%`}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {folderGroups.length > 0 ? (
            <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-zinc-800">Folder Diterima</h2>
                <p className="text-xs text-zinc-500">
                  Simpan seluruh struktur folder langsung ke perangkat. Hanya tersedia di browser yang
                  mendukung File System Access API.
                </p>
              </div>
              <ul className="space-y-2 text-sm">
                {folderGroups.map((group) => {
                  const ready = group.files.every((file) => file.status === "complete" && file.blob);
                  const busy = processingFolder === group.folderName;
                  return (
                    <li
                      key={group.folderName}
                      className="flex flex-col gap-2 rounded-md border border-zinc-200 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-zinc-800">{group.folderName}</span>
                        <span className="text-xs text-zinc-500">
                          {group.files.length} berkas • {ready ? "Siap disimpan" : "Menunggu berkas selesai"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleSaveFolder(group.folderName)}
                        disabled={!ready || busy}
                        className={`rounded-md px-3 py-2 text-xs font-semibold text-white transition ${
                          ready && !busy
                            ? "bg-emerald-600 hover:bg-emerald-500"
                            : "cursor-not-allowed bg-zinc-400"
                        }`}
                      >
                        {busy ? "Memproses..." : "Simpan Folder"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {folderActionMessage ? (
                <p className="text-xs text-zinc-500">{folderActionMessage}</p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-zinc-800">Berkas Diterima</h2>
            {incomingFiles.length === 0 ? (
              <p className="text-sm text-zinc-500">Belum ada berkas yang masuk.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {incomingFiles.map((transfer) => {
                  const progress = transfer.meta.totalChunks
                    ? Math.round((transfer.receivedChunks / transfer.meta.totalChunks) * 100)
                    : 0;

                  return (
                    <li
                      key={transfer.meta.transferId}
                      className="rounded-md border border-zinc-200 p-3"
                    >
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-zinc-800">
                          {transfer.meta.relativePath ?? transfer.meta.name}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {transfer.status === "complete"
                            ? "Selesai diterima. Klik untuk unduh."
                            : transfer.status === "error"
                              ? transfer.errorMessage ?? "Terjadi kesalahan saat menerima."
                              : `Menerima... ${progress}%`}
                        </span>
                        {transfer.status === "complete" && transfer.downloadUrl ? (
                          <a
                            href={transfer.downloadUrl}
                            download={transfer.meta.name}
                            className="mt-2 inline-flex w-max rounded-md bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800"
                          >
                            Unduh
                          </a>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            Simpan berkas yang diterima ke folder tujuan Anda. Folder lengkap akan muncul sebagai banyak berkas
            dengan struktur relatif yang dipertahankan.
          </p>
        </div>
      )}
    </section>
  );
}
