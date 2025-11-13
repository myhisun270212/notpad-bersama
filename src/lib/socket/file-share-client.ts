import { io, type ManagerOptions, type Socket, type SocketOptions } from "socket.io-client";

type ConnectFileShareSocketOptions = {
  endpoint?: string;
};

export const connectFileShareSocket = (options: ConnectFileShareSocketOptions = {}): Socket => {
  const { endpoint } = options;

  const socketOptions: Partial<ManagerOptions & SocketOptions> = {
    path: "/api/socket/file-share",
    transports: ["websocket"],
    timeout: 10_000,
  };

  return endpoint && endpoint.trim() !== ""
    ? io(endpoint.trim(), socketOptions)
    : io(socketOptions);
};
