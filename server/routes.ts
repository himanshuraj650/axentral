import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";
import { api, wsEvents } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const configuredOrigins = (
    process.env.APP_ORIGINS ||
    process.env.APP_ORIGIN ||
    process.env.RENDER_EXTERNAL_URL ||
    ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/\/$/, ""));

  const allowAnyOrigin = configuredOrigins.includes("*");

  const normalizeOrigin = (value: string) => value.replace(/\/$/, "");

  const isOriginAllowed = (origin: string | undefined, reqHost: string | undefined) => {
    if (!origin) {
      return true;
    }

    if (allowAnyOrigin) {
      return true;
    }

    const normalizedOrigin = normalizeOrigin(origin);

    if (configuredOrigins.length > 0) {
      return configuredOrigins.includes(normalizedOrigin);
    }

    if (!reqHost) {
      return false;
    }

    const inferredAllowed = [
      `http://${reqHost}`,
      `https://${reqHost}`,
    ];

    return inferredAllowed.includes(normalizedOrigin);
  };
  const allowServerCallLogs = process.env.ALLOW_SERVER_CALL_LOGS === "true";
  const allowPersistentRoomStorage = process.env.ALLOW_PERSISTENT_ROOM_STORAGE === "true";
  const WS_MAX_PAYLOAD_BYTES = Math.max(
    256 * 1024,
    Number(process.env.WS_MAX_PAYLOAD_BYTES || 2 * 1024 * 1024)
  );
  const WS_RATE_WINDOW_MS = 10_000;
  const WS_RATE_MAX_MESSAGES = 120;

  app.get(api.security.mode.path, (_req, res) => {
    return res.status(200).json({
      ephemeralMode: !allowPersistentRoomStorage && !allowServerCallLogs,
      persistentRoomStorage: allowPersistentRoomStorage,
      persistentCallLogs: allowServerCallLogs,
    });
  });

  app.get(api.turn.credentials.path, async (_req, res) => {
    const hardcodedFallbackTurnUrls = [
      "turn:global.relay.metered.ca:80",
      "turn:global.relay.metered.ca:80?transport=tcp",
      "turn:global.relay.metered.ca:443",
      "turns:global.relay.metered.ca:443?transport=tcp",
    ];
    const hardcodedFallbackTurnUsername = "16a4e8bb6e29530708bfaf64";
    const hardcodedFallbackTurnCredential = "D5ziBUVmttXhuuai";

    const staticTurnUrls = (process.env.TURN_URLS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const staticTurnUsername = process.env.TURN_USERNAME;
    const staticTurnCredential = process.env.TURN_CREDENTIAL;

    if (staticTurnUrls.length > 0 && staticTurnUsername && staticTurnCredential) {
      return res.status(200).json({
        iceServers: [
          {
            urls: staticTurnUrls,
            username: staticTurnUsername,
            credential: staticTurnCredential,
          },
        ],
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });
    }

    const meteredDomainRaw = process.env.METERED_DOMAIN;
    const meteredApiKey = process.env.METERED_API_KEY || process.env.METERED_SECRET_KEY;
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const ttlSec = Math.max(300, Number(process.env.TWILIO_TTL_SEC || 3600));

    const meteredDomain = (meteredDomainRaw || "")
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");

    if (meteredDomain && meteredApiKey) {
      try {
        const meteredUrl = `https://${meteredDomain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(meteredApiKey)}`;
        const meteredRes = await fetch(meteredUrl, { signal: AbortSignal.timeout(5000) });

        if (meteredRes.ok) {
          const meteredIceServers = await meteredRes.json() as Array<{
            urls: string | string[];
            username?: string;
            credential?: string;
          }>;

          const iceServers = (meteredIceServers || [])
            .filter((server) => !!server?.urls)
            .map((server) => ({
              urls: server.urls,
              username: server.username,
              credential: server.credential,
            }));

          return res.status(200).json({
            iceServers,
            expiresAt: Date.now() + 10 * 60 * 1000,
          });
        }

        const errorText = await meteredRes.text();
        console.warn(`Metered TURN failed (${meteredRes.status}): ${errorText}`);
      } catch (err) {
        console.warn("Metered TURN request failed", err);
      }
    }

    if (accountSid && authToken) {
      try {
        const tokenUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Tokens.json`;
        const body = new URLSearchParams({ Ttl: String(ttlSec) });
        const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

        const twilioRes = await fetch(tokenUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${authHeader}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        });

        if (twilioRes.ok) {
          const twilioData = await twilioRes.json() as {
            ice_servers?: Array<{
              urls: string | string[];
              username?: string;
              credential?: string;
            }>;
          };

          const iceServers = (twilioData.ice_servers || [])
            .filter((server) => !!server?.urls)
            .map((server) => ({
              urls: server.urls,
              username: server.username,
              credential: server.credential,
            }));

          return res.status(200).json({
            iceServers,
            expiresAt: Date.now() + ttlSec * 1000,
          });
        }

        const twilioErrText = await twilioRes.text();
        console.warn(`Twilio TURN failed (${twilioRes.status}): ${twilioErrText}`);
      } catch (err) {
        console.warn("Twilio TURN request failed", err);
      }
    }

    if (hardcodedFallbackTurnUrls.length > 0 && hardcodedFallbackTurnUsername && hardcodedFallbackTurnCredential) {
      return res.status(200).json({
        iceServers: [
          {
            urls: hardcodedFallbackTurnUrls,
            username: hardcodedFallbackTurnUsername,
            credential: hardcodedFallbackTurnCredential,
          },
        ],
        expiresAt: Date.now() + 60 * 60 * 1000,
      });
    }

    return res.status(200).json({
      iceServers: [
        { urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
      ],
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
  });

  const presenceMap = new Map<string, {
    userId: string;
    displayName: string;
    lastSeenAt: number;
  }>();

  const inviteMap = new Map<string, Array<{
    roomId: string;
    fromUserId: string;
    fromDisplayName: string;
    createdAt: number;
  }>>();

  const upsertPresence = (userId: string, displayName: string) => {
    presenceMap.set(userId, {
      userId,
      displayName,
      lastSeenAt: Date.now(),
    });
  };

  const createUniqueRoomId = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const roomId = Math.random().toString(36).substring(2, 12).toUpperCase();
      const existing = await storage.getRoom(roomId);
      if (!existing) {
        return roomId;
      }
    }

    return Math.random().toString(36).substring(2, 14).toUpperCase();
  };

  const callLogsMap = new Map<string, Array<{
    id: string;
    roomId: string;
    direction: "incoming" | "outgoing";
    callType: "audio" | "video";
    outcome: "completed" | "missed" | "rejected" | "cancelled" | "failed";
    startedAt: number;
    endedAt: number;
    durationSec: number;
  }>>();

  app.post(api.rooms.create.path, async (req, res) => {
    try {

      const input = api.rooms.create.input?.parse(req.body) || {};

      const roomId =
        input.id?.trim().toUpperCase() ||
        Math.random().toString(36).substring(2, 12).toUpperCase();
      const creatorDisplayName =
        typeof input.creatorDisplayName === "string" && input.creatorDisplayName.trim()
          ? input.creatorDisplayName.trim().slice(0, 32)
          : undefined;

      if (!/^[A-Z0-9]{6,20}$/.test(roomId)) {
        return res.status(400).json({ message: "Room ID must be 6-20 chars (A-Z, 0-9).", field: "id" });
      }

      const room = await storage.createRoom({ id: roomId, creatorDisplayName });

      res.status(201).json(room);

    } catch (err) {

      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }

      throw err;
    }
  });

  app.get(api.rooms.get.path, async (req, res) => {

    const room = await storage.getRoom(req.params.id);

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    res.json(room);

  });

  app.get(api.rooms.callLogs.list.path, (req, res) => {
    if (!allowServerCallLogs) {
      return res.json([]);
    }

    const roomId = req.params.id;
    const logs = callLogsMap.get(roomId) || [];
    res.json(logs);
  });

  app.post(api.rooms.callLogs.create.path, (req, res) => {
    if (!allowServerCallLogs) {
      return res.status(201).json({ ok: true, persisted: false });
    }

    try {
      const roomId = req.params.id;
      const log = api.rooms.callLogs.create.input.parse(req.body);

      if (log.roomId !== roomId) {
        return res.status(400).json({ message: "Room ID mismatch" });
      }

      const logs = callLogsMap.get(roomId) || [];
      const deduped = logs.filter((item) => item.id !== log.id);
      const next = [log, ...deduped].slice(0, 100);
      callLogsMap.set(roomId, next);

      return res.status(201).json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }

      throw err;
    }
  });

  app.delete(api.rooms.callLogs.clear.path, (req, res) => {
    if (!allowServerCallLogs) {
      return res.status(200).json({ ok: true });
    }

    const roomId = req.params.id;
    callLogsMap.set(roomId, []);
    return res.status(200).json({ ok: true });
  });

  app.post(api.presence.register.path, (req, res) => {
    try {
      const input = api.presence.register.input.parse(req.body);
      upsertPresence(input.userId.trim().toUpperCase(), input.displayName.trim());
      return res.status(200).json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }

      throw err;
    }
  });

  app.get(api.presence.online.path, (req, res) => {
    const query = String(req.query.q || '').trim().toLowerCase();
    const self = String(req.query.self || '').trim().toUpperCase();
    const now = Date.now();
    const onlineWindowMs = 30_000;

    const users = Array.from(presenceMap.values())
      .filter((user) => user.userId !== self)
      .filter((user) => now - user.lastSeenAt <= onlineWindowMs)
      .filter((user) => {
        if (!query) return true;
        return (
          user.userId.toLowerCase().includes(query) ||
          user.displayName.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, 100)
      .map((user) => ({
        userId: user.userId,
        displayName: user.displayName,
        lastSeenAt: user.lastSeenAt,
        isOnline: true,
      }));

    return res.status(200).json(users);
  });

  app.post(api.presence.connect.user.path, async (req, res) => {
    try {
      const input = api.presence.connect.user.input.parse(req.body);
      const fromUserId = input.fromUserId.trim().toUpperCase();
      const toUserId = input.toUserId.trim().toUpperCase();

      const fromUser = presenceMap.get(fromUserId);
      const toUser = presenceMap.get(toUserId);

      if (!fromUser || !toUser) {
        return res.status(404).json({ message: 'User not online' });
      }

      const roomId = await createUniqueRoomId();
      await storage.createRoom({ id: roomId });

      const invites = inviteMap.get(toUserId) || [];
      const nextInvites = [
        {
          roomId,
          fromUserId,
          fromDisplayName: fromUser.displayName,
          createdAt: Date.now(),
        },
        ...invites.filter((invite) => invite.roomId !== roomId),
      ].slice(0, 50);

      inviteMap.set(toUserId, nextInvites);

      return res.status(200).json({ ok: true, roomId });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }

      throw err;
    }
  });

  app.post(api.presence.connect.random.path, async (req, res) => {
    try {
      const input = api.presence.connect.random.input.parse(req.body);
      const fromUserId = input.fromUserId.trim().toUpperCase();
      const fromUser = presenceMap.get(fromUserId);

      if (!fromUser) {
        return res.status(404).json({ message: 'Register presence first' });
      }

      const now = Date.now();
      const candidates = Array.from(presenceMap.values())
        .filter((user) => user.userId !== fromUserId)
        .filter((user) => now - user.lastSeenAt <= 30_000);

      if (candidates.length === 0) {
        return res.status(404).json({ message: 'No online users available' });
      }

      const matched = candidates[Math.floor(Math.random() * candidates.length)];
      const roomId = await createUniqueRoomId();
      await storage.createRoom({ id: roomId });

      const invites = inviteMap.get(matched.userId) || [];
      inviteMap.set(
        matched.userId,
        [
          {
            roomId,
            fromUserId,
            fromDisplayName: fromUser.displayName,
            createdAt: Date.now(),
          },
          ...invites.filter((invite) => invite.roomId !== roomId),
        ].slice(0, 50)
      );

      return res.status(200).json({ ok: true, roomId, matchedUserId: matched.userId });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }

      throw err;
    }
  });

  app.get(api.presence.invites.list.path, (req, res) => {
    const userId = req.params.userId.trim().toUpperCase();
    const invites = inviteMap.get(userId) || [];

    const freshInvites = invites
      .filter((invite) => Date.now() - invite.createdAt <= 5 * 60_000)
      .slice(0, 30);

    inviteMap.set(userId, freshInvites);

    return res.status(200).json(freshInvites);
  });

  app.post(api.presence.invites.accept.path, (req, res) => {
    const userId = req.params.userId.trim().toUpperCase();
    const roomId = req.params.roomId.trim().toUpperCase();
    const invites = inviteMap.get(userId) || [];

    const found = invites.find((invite) => invite.roomId === roomId);
    if (!found) {
      return res.status(404).json({ message: 'Invite not found' });
    }

    inviteMap.set(userId, invites.filter((invite) => invite.roomId !== roomId));
    return res.status(200).json({ ok: true, roomId });
  });

  app.post(api.presence.invites.reject.path, (req, res) => {
    const userId = req.params.userId.trim().toUpperCase();
    const roomId = req.params.roomId.trim().toUpperCase();
    const invites = inviteMap.get(userId) || [];

    const found = invites.find((invite) => invite.roomId === roomId);
    if (!found) {
      return res.status(404).json({ message: 'Invite not found' });
    }

    inviteMap.set(userId, invites.filter((invite) => invite.roomId !== roomId));
    return res.status(200).json({ ok: true });
  });

  const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
    maxHttpBufferSize: WS_MAX_PAYLOAD_BYTES,
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin, undefined)) {
          callback(null, true);
          return;
        }
        callback(new Error("Origin not allowed"));
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
  });

  const ioRoomsMap = new Map<string, Set<string>>();
  const ioRateState = new Map<string, { count: number; windowStart: number }>();

  const isWithinIoRateLimit = (socketId: string) => {
    const now = Date.now();
    const state = ioRateState.get(socketId);

    if (!state || now - state.windowStart >= WS_RATE_WINDOW_MS) {
      ioRateState.set(socketId, { count: 1, windowStart: now });
      return true;
    }

    state.count += 1;
    return state.count <= WS_RATE_MAX_MESSAGES;
  };

  const leaveIoRoom = (socketId: string, roomId: string | null) => {
    if (!roomId || !ioRoomsMap.has(roomId)) return;

    const roomClients = ioRoomsMap.get(roomId)!;
    roomClients.delete(socketId);

    io.to(roomId).emit("signal", {
      type: "userLeft",
      payload: { clientsCount: roomClients.size },
    });

    if (roomClients.size === 0) {
      ioRoomsMap.delete(roomId);
    }
  };

  const pruneDisconnectedIoRoomClients = (roomId: string) => {
    const roomClients = ioRoomsMap.get(roomId);
    if (!roomClients) return;

    for (const socketId of Array.from(roomClients)) {
      if (!io.sockets.sockets.has(socketId)) {
        roomClients.delete(socketId);
      }
    }

    if (roomClients.size === 0) {
      ioRoomsMap.delete(roomId);
    }
  };

  io.on("connection", (socket) => {
    let currentRoomId: string | null = null;

    socket.on("signal", async (rawMessage: any) => {
      try {
        if (!isWithinIoRateLimit(socket.id)) {
          socket.emit("signal", {
            type: "error",
            payload: { message: "Rate limit exceeded" },
          });
          return;
        }

        const payloadSize = Buffer.byteLength(JSON.stringify(rawMessage ?? {}));
        if (payloadSize > WS_MAX_PAYLOAD_BYTES) {
          socket.emit("signal", {
            type: "error",
            payload: { message: "Payload too large" },
          });
          return;
        }

        const type = rawMessage?.type;
        const payload = rawMessage?.payload;

        if (type === "ping") {
          socket.emit("signal", {
            type: "pong",
            payload: { ts: Date.now() },
          });
          return;
        }

        if (type === "join") {
          const parsed = wsEvents.send.join.parse(payload);
          const requestedRoomId = parsed.roomId.trim().toUpperCase();
          const existingRoom = await storage.getRoom(requestedRoomId);

          if (!existingRoom) {
            socket.emit("signal", {
              type: "error",
              payload: { message: "Room does not exist" },
            });
            return;
          }

          if (currentRoomId && currentRoomId !== requestedRoomId) {
            socket.leave(currentRoomId);
            leaveIoRoom(socket.id, currentRoomId);
          }

          if (!ioRoomsMap.has(requestedRoomId)) {
            ioRoomsMap.set(requestedRoomId, new Set());
          }

          pruneDisconnectedIoRoomClients(requestedRoomId);
          const roomClients = ioRoomsMap.get(requestedRoomId)!;
          if (!roomClients.has(socket.id) && roomClients.size >= 2) {
            socket.emit("signal", {
              type: "error",
              payload: { message: "Room is full" },
            });
            return;
          }

          currentRoomId = requestedRoomId;
          roomClients.add(socket.id);
          socket.join(requestedRoomId);

          io.to(requestedRoomId).emit("signal", {
            type: "userJoined",
            payload: { clientsCount: roomClients.size },
          });
          return;
        }

        if (!currentRoomId) return;

        if (type === "publicKey") {
          const parsed = wsEvents.send.publicKey.parse(payload);
          socket.to(currentRoomId).emit("signal", {
            type: "publicKey",
            payload: { publicKey: parsed.publicKey },
          });
          return;
        }

        if (type === "message") {
          const parsed = wsEvents.send.message.parse(payload);
          socket.to(currentRoomId).emit("signal", {
            type: "message",
            payload: {
              encryptedPayload: parsed.encryptedPayload,
              iv: parsed.iv,
              timestamp: Date.now(),
            },
          });
          return;
        }

        if (type === "messageChunk") {
          const parsed = wsEvents.send.messageChunk.parse(payload);
          socket.to(currentRoomId).emit("signal", {
            type: "messageChunk",
            payload: {
              messageId: parsed.messageId,
              encryptedChunk: parsed.encryptedChunk,
              iv: parsed.iv,
              index: parsed.index,
              total: parsed.total,
              timestamp: parsed.timestamp,
            },
          });
          return;
        }

        if (type === "typing") {
          const parsed = wsEvents.send.typing.parse(payload);
          socket.to(currentRoomId).emit("signal", {
            type: "typing",
            payload: { isTyping: parsed.isTyping },
          });
          return;
        }

        if (type === "callSignal") {
          const parsed = wsEvents.send.callSignal.parse(payload);
          socket.to(currentRoomId).emit("signal", {
            type: "callSignal",
            payload: {
              encryptedPayload: parsed.encryptedPayload,
              iv: parsed.iv,
              timestamp: Date.now(),
            },
          });
          return;
        }

        if (type === "callSignalPlain") {
          const signal = payload?.signal;
          const kind = signal?.kind;

          if (
            !signal ||
            (kind !== "call-offer" &&
              kind !== "call-answer" &&
              kind !== "ice-candidate" &&
              kind !== "call-end" &&
              kind !== "call-reject")
          ) {
            socket.emit("signal", {
              type: "error",
              payload: { message: "Invalid call signal" },
            });
            return;
          }

          socket.to(currentRoomId).emit("signal", {
            type: "callSignalPlain",
            payload: {
              signal,
              timestamp: Date.now(),
            },
          });
          return;
        }

        if (type === "leave") {
          socket.leave(currentRoomId);
          leaveIoRoom(socket.id, currentRoomId);
          currentRoomId = null;
        }
      } catch {
        socket.emit("signal", {
          type: "error",
          payload: { message: "Invalid message format" },
        });
      }
    });

    socket.on("disconnect", () => {
      leaveIoRoom(socket.id, currentRoomId);
      ioRateState.delete(socket.id);
      currentRoomId = null;
    });
  });

  const wss = new WebSocketServer({
    noServer: true,
  });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url || "";
    const origin = req.headers.origin;
    const reqHost = typeof req.headers.host === "string" ? req.headers.host : undefined;

    if (!url.startsWith("/ws")) {
      return;
    }

    if (!isOriginAllowed(origin, reqHost)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit("connection", client, req);
    });
  });

  const roomsMap = new Map<string, Set<WebSocket>>();
  const wsRateState = new WeakMap<WebSocket, { count: number; windowStart: number }>();

  const isWithinWsRateLimit = (ws: WebSocket) => {
    const now = Date.now();
    const state = wsRateState.get(ws);

    if (!state || now - state.windowStart >= WS_RATE_WINDOW_MS) {
      wsRateState.set(ws, { count: 1, windowStart: now });
      return true;
    }

    state.count += 1;
    return state.count <= WS_RATE_MAX_MESSAGES;
  };

  wss.on("connection", (ws) => {

    let currentRoomId: string | null = null;

    ws.on("message", async (data) => {

      try {
        if (!isWithinWsRateLimit(ws)) {
          ws.send(JSON.stringify({
            type: "error",
            payload: { message: "Rate limit exceeded" },
          }));
          return;
        }

        const payloadSize = (() => {
          if (typeof data === "string") return Buffer.byteLength(data);
          if (Array.isArray(data)) return data.reduce((sum, chunk) => sum + chunk.length, 0);
          if (data instanceof ArrayBuffer) return data.byteLength;
          return data.length;
        })();
        if (payloadSize > WS_MAX_PAYLOAD_BYTES) {
          ws.send(JSON.stringify({
            type: "error",
            payload: { message: "Payload too large" },
          }));
          return;
        }

        const rawMessage = JSON.parse(data.toString());

        const type = rawMessage.type;
        const payload = rawMessage.payload;

        if (type === "ping") {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "pong",
              payload: { ts: Date.now() },
            }));
          }
          return;
        }

        if (type === "join") {

          const parsed = wsEvents.send.join.parse(payload);

          const requestedRoomId = parsed.roomId.trim().toUpperCase();
          const existingRoom = await storage.getRoom(requestedRoomId);
          if (!existingRoom) {
            ws.send(JSON.stringify({
              type: "error",
              payload: { message: "Room does not exist" },
            }));
            return;
          }

          currentRoomId = requestedRoomId;

          if (!roomsMap.has(currentRoomId)) {
            roomsMap.set(currentRoomId, new Set());
          }

          const roomClients = roomsMap.get(currentRoomId)!;

          if (!roomClients.has(ws) && roomClients.size >= 2) {
            ws.send(JSON.stringify({
              type: "error",
              payload: { message: "Room is full" },
            }));
            return;
          }

          roomClients.add(ws);

          const joinMsg = JSON.stringify({
            type: "userJoined",
            payload: { clientsCount: roomClients.size },
          });

          roomClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(joinMsg);
            }
          });

        }

        else if (type === "publicKey" && currentRoomId) {

          const parsed = wsEvents.send.publicKey.parse(payload);

          const msg = JSON.stringify({
            type: "publicKey",
            payload: { publicKey: parsed.publicKey },
          });

          const roomClients = roomsMap.get(currentRoomId)!;

          roomClients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          });

        }

        else if (type === "message" && currentRoomId) {

          const parsed = wsEvents.send.message.parse(payload);

          const msg = JSON.stringify({
            type: "message",
            payload: {
              encryptedPayload: parsed.encryptedPayload,
              iv: parsed.iv,
              timestamp: Date.now(),
            },
          });

          const roomClients = roomsMap.get(currentRoomId)!;

          roomClients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          });

        }

        else if (type === "typing" && currentRoomId) {

          const parsed = wsEvents.send.typing.parse(payload);

          const msg = JSON.stringify({
            type: "typing",
            payload: { isTyping: parsed.isTyping },
          });

          const roomClients = roomsMap.get(currentRoomId)!;

          roomClients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          });

        }

        else if (type === "callSignal" && currentRoomId) {

          const parsed = wsEvents.send.callSignal.parse(payload);

          const roomClients = roomsMap.get(currentRoomId)!;

          const relayMsg = JSON.stringify({
            type: "callSignal",
            payload: {
              encryptedPayload: parsed.encryptedPayload,
              iv: parsed.iv,
              timestamp: Date.now(),
            }
          });

          roomClients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(relayMsg);
            }
          });

        }

      } catch (err) {
        ws.send(JSON.stringify({
          type: "error",
          payload: { message: "Invalid message format" }
        }));

      }

    });

    ws.on("close", () => {

      if (currentRoomId && roomsMap.has(currentRoomId)) {

        const roomClients = roomsMap.get(currentRoomId)!;

        roomClients.delete(ws);

        const leaveMsg = JSON.stringify({
          type: "userLeft",
          payload: { clientsCount: roomClients.size }
        });

        roomClients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(leaveMsg);
          }
        });

        if (roomClients.size === 0) {
          roomsMap.delete(currentRoomId);
        }

      }

    });

  });

  return httpServer;
}
