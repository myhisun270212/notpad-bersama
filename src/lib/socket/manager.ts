import type { Server as IOServer } from "socket.io";

const globalForSocket = globalThis as unknown as {
  io?: IOServer;
};

export const setIO = (io: IOServer) => {
  globalForSocket.io = io;
};

export const getIO = () => {
  if (!globalForSocket.io) {
    throw new Error("Socket.io server is not initialized");
  }
  return globalForSocket.io;
};

export const hasIO = () => typeof globalForSocket.io !== "undefined";
