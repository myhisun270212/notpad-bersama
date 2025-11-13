import type { NextApiRequest, NextApiResponse } from "next";
import type { Server as HTTPServer } from "http";
import type { Socket as NetSocket } from "net";
import { Server as IOServer } from "socket.io";

export const config = {
  api: {
    bodyParser: false,
  },
};

type SocketServerWithFileShare = HTTPServer & {
  fileShareIO?: IOServer;
};

type SocketWithFileShare = NetSocket & {
  server: SocketServerWithFileShare;
};

const createFileShareServer = (server: SocketServerWithFileShare) => {
  const io = new IOServer(server, {
    path: "/api/socket/file-share",
    addTrailingSlash: false,
    transports: ["websocket"],
    maxHttpBufferSize: 2 * 1024 * 1024 * 1024, // 2 GB
  });

  io.on("connection", (client) => {
    client.on("room:join", ({ roomId }) => {
      if (typeof roomId !== "string" || roomId.trim() === "") {
        return;
      }

      client.join(roomId);
      client.emit("room:joined", { roomId });
      client.to(roomId).emit("peer:joined", { roomId });
    });

    client.on("room:leave", ({ roomId }) => {
      if (typeof roomId !== "string" || roomId.trim() === "") {
        return;
      }

      client.leave(roomId);
      client.to(roomId).emit("peer:left", { roomId });
    });

    client.on("file:meta", (payload) => {
      const { roomId } = payload ?? {};
      if (typeof roomId !== "string" || roomId.trim() === "") {
        return;
      }

      client.to(roomId).emit("file:meta", payload);
    });

    client.on("file:chunk", (payload) => {
      const { roomId } = payload ?? {};
      if (typeof roomId !== "string" || roomId.trim() === "") {
        return;
      }

      client.to(roomId).emit("file:chunk", payload);
    });

    client.on("file:complete", (payload) => {
      const { roomId } = payload ?? {};
      if (typeof roomId !== "string" || roomId.trim() === "") {
        return;
      }

      client.to(roomId).emit("file:complete", payload);
    });

    client.on("file:error", (payload) => {
      const { roomId } = payload ?? {};
      if (typeof roomId !== "string" || roomId.trim() === "") {
        return;
      }

      client.to(roomId).emit("file:error", payload);
    });

    client.on("disconnect", () => {
      const joinedRooms = Array.from(client.rooms).filter((room) => room !== client.id);
      joinedRooms.forEach((roomId) => {
        client.to(roomId).emit("peer:left", { roomId });
      });
    });
  });

  return io;
};

const handler = (_req: NextApiRequest, res: NextApiResponse) => {
  const socket = res.socket as SocketWithFileShare;

  if (!socket.server.fileShareIO) {
    socket.server.fileShareIO = createFileShareServer(socket.server);
  }

  res.end();
};

export default handler;
