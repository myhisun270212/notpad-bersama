import type { NextApiRequest, NextApiResponse } from "next";
import type { Server as HTTPServer } from "http";
import type { Socket as NetSocket } from "net";
import { Server as IOServer } from "socket.io";
import { hasIO, setIO } from "@/lib/socket/manager";

export const config = {
  api: {
    bodyParser: false,
  },
};

type SocketServer = HTTPServer & {
  io?: IOServer;
};

type SocketWithIO = NetSocket & {
  server: SocketServer;
};

const ioHandler = (req: NextApiRequest, res: NextApiResponse) => {
  if (!hasIO()) {
    const socket = res.socket as SocketWithIO;

    if (!socket.server.io) {
      const io = new IOServer(socket.server, {
        path: "/api/socket/io",
        addTrailingSlash: false,
      });

      io.on("connection", (client) => {
        client.on("note:title", (payload) => {
          client.broadcast.emit("note:title", payload);
        });
        client.on("note:content", (payload) => {
          client.broadcast.emit("note:content", payload);
        });
      });

      setIO(io);
    }
  }

  res.end();
};

export default ioHandler;
