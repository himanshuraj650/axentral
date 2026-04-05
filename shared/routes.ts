import { z } from 'zod';
import { insertRoomSchema, rooms } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  security: {
    mode: {
      method: 'GET' as const,
      path: '/api/security/mode' as const,
      responses: {
        200: z.object({
          ephemeralMode: z.boolean(),
          persistentRoomStorage: z.boolean(),
          persistentCallLogs: z.boolean(),
        }),
      },
    },
  },
  rooms: {
    create: {
      method: 'POST' as const,
      path: '/api/rooms' as const,
      input: z.object({ id: z.string().optional() }).optional(),
      responses: {
        201: z.custom<typeof rooms.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/rooms/:id' as const,
      responses: {
        200: z.custom<typeof rooms.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    callLogs: {
      list: {
        method: 'GET' as const,
        path: '/api/rooms/:id/calls' as const,
        responses: {
          200: z.array(
            z.object({
              id: z.string(),
              roomId: z.string(),
              direction: z.enum(['incoming', 'outgoing']),
              callType: z.enum(['audio', 'video']),
              outcome: z.enum(['completed', 'missed', 'rejected', 'cancelled', 'failed']),
              startedAt: z.number(),
              endedAt: z.number(),
              durationSec: z.number(),
            })
          ),
        },
      },
      create: {
        method: 'POST' as const,
        path: '/api/rooms/:id/calls' as const,
        input: z.object({
          id: z.string(),
          roomId: z.string(),
          direction: z.enum(['incoming', 'outgoing']),
          callType: z.enum(['audio', 'video']),
          outcome: z.enum(['completed', 'missed', 'rejected', 'cancelled', 'failed']),
          startedAt: z.number(),
          endedAt: z.number(),
          durationSec: z.number(),
        }),
        responses: {
          201: z.object({ ok: z.literal(true) }),
          400: errorSchemas.validation,
        },
      },
      clear: {
        method: 'DELETE' as const,
        path: '/api/rooms/:id/calls' as const,
        responses: {
          200: z.object({ ok: z.literal(true) }),
        },
      },
    },
  },
  presence: {
    register: {
      method: 'POST' as const,
      path: '/api/presence/register' as const,
      input: z.object({
        userId: z.string().min(3).max(24),
        displayName: z.string().min(2).max(32),
      }),
      responses: {
        200: z.object({ ok: z.literal(true) }),
        400: errorSchemas.validation,
      },
    },
    online: {
      method: 'GET' as const,
      path: '/api/presence/online' as const,
      responses: {
        200: z.array(
          z.object({
            userId: z.string(),
            displayName: z.string(),
            lastSeenAt: z.number(),
            isOnline: z.boolean(),
          })
        ),
      },
    },
    connect: {
      user: {
        method: 'POST' as const,
        path: '/api/presence/connect/user' as const,
        input: z.object({
          fromUserId: z.string(),
          toUserId: z.string(),
        }),
        responses: {
          200: z.object({
            ok: z.literal(true),
            roomId: z.string(),
          }),
          404: errorSchemas.notFound,
        },
      },
      random: {
        method: 'POST' as const,
        path: '/api/presence/connect/random' as const,
        input: z.object({
          fromUserId: z.string(),
        }),
        responses: {
          200: z.object({
            ok: z.literal(true),
            roomId: z.string(),
            matchedUserId: z.string(),
          }),
          404: errorSchemas.notFound,
        },
      },
    },
    invites: {
      list: {
        method: 'GET' as const,
        path: '/api/presence/invites/:userId' as const,
        responses: {
          200: z.array(
            z.object({
              roomId: z.string(),
              fromUserId: z.string(),
              fromDisplayName: z.string(),
              createdAt: z.number(),
            })
          ),
        },
      },
      accept: {
        method: 'POST' as const,
        path: '/api/presence/invites/:userId/:roomId/accept' as const,
        responses: {
          200: z.object({ ok: z.literal(true), roomId: z.string() }),
          404: errorSchemas.notFound,
        },
      },
      reject: {
        method: 'POST' as const,
        path: '/api/presence/invites/:userId/:roomId/reject' as const,
        responses: {
          200: z.object({ ok: z.literal(true) }),
          404: errorSchemas.notFound,
        },
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

// WebSocket Event Contracts for Signaling and E2EE Messaging
export const wsEvents = {
  send: {
    join: z.object({ roomId: z.string() }),
    publicKey: z.object({ roomId: z.string(), publicKey: z.string() }),
    message: z.object({ roomId: z.string(), encryptedPayload: z.string(), iv: z.string() }),
    typing: z.object({ roomId: z.string(), isTyping: z.boolean() }),
    callSignal: z.object({ roomId: z.string(), encryptedPayload: z.string(), iv: z.string() }),
    leave: z.object({ roomId: z.string() })
  },
  receive: {
    userJoined: z.object({ clientsCount: z.number() }),
    publicKey: z.object({ publicKey: z.string() }),
    message: z.object({ encryptedPayload: z.string(), iv: z.string(), timestamp: z.number() }),
    typing: z.object({ isTyping: z.boolean() }),
    callSignal: z.object({ encryptedPayload: z.string(), iv: z.string(), timestamp: z.number() }),
    userLeft: z.object({ clientsCount: z.number() }),
    error: z.object({ message: z.string() })
  }
};
