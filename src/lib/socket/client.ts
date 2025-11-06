import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export const initSocket = () => {
  if (!socket) {
    socket = io({
      path: "/api/socket/io",
    });
  }

  return socket;
};

export const shutdownSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
