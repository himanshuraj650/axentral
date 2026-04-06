import { useState, useEffect, useRef, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import { api, buildUrl, wsEvents } from "@shared/routes";
import { toast as showToast } from "@/hooks/use-toast";
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSecret,
  encryptMessage,
  decryptMessage,
} from "@/lib/crypto";

export type ChatMessage = {
  id: string;
  text?: string;
  image?: string;
  file?: {
    name: string;
    mimeType: string;
    size: number;
    dataUrl: string;
  };
  isMine: boolean;
  timestamp: number;
  expiresAt: number | null;
};

type CallType = "audio" | "video";

type CallDirection = "incoming" | "outgoing";

type CallOutcome = "completed" | "missed" | "rejected" | "cancelled" | "failed";

type CallConnectionQuality = "idle" | "connecting" | "good" | "degraded" | "lost";

export type CallLog = {
  id: string;
  roomId: string;
  direction: CallDirection;
  callType: CallType;
  outcome: CallOutcome;
  startedAt: number;
  endedAt: number;
  durationSec: number;
};

type SignalPayload =
  | {
      kind: "call-offer";
      callType: CallType;
      sdp: RTCSessionDescriptionInit;
    }
  | {
      kind: "call-answer";
      sdp: RTCSessionDescriptionInit;
    }
  | {
      kind: "ice-candidate";
      candidate: RTCIceCandidateInit;
    }
  | {
      kind: "call-end";
    }
  | {
      kind: "call-reject";
    };

export type CallState = {
  isCalling: boolean;
  isReceiving: boolean;
  isInCall: boolean;
  callType: CallType | null;
  status: "idle" | "outgoing" | "incoming" | "connecting" | "active";
  connectionQuality: CallConnectionQuality;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  micMuted: boolean;
  cameraOff: boolean;
  cameraFacing: "user" | "environment";
  error: string | null;
  startedAt: number | null;
  durationSec: number;
};

export type ConnectionState =
  | "connecting"
  | "waiting_for_peer"
  | "generating_keys"
  | "secured"
  | "disconnected"
  | "error";

type CompatSocketMessage = { data: string };

type CompatSocket = {
  readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: CompatSocketMessage) => void) | null;
  send: (data: string) => void;
  close: () => void;
};

const WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

const CHUNKED_MESSAGE_SIZE = 512 * 1024;
const CHUNKED_MESSAGE_TTL_MS = 2 * 60 * 1000;

function createSocketIoCompatSocket(): CompatSocket {
  const socket: Socket = io({
    path: "/socket.io",
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  });

  const compat: CompatSocket = {
    readyState: WS_READY_STATE.CONNECTING,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send: (data: string) => {
      try {
        socket.emit("signal", JSON.parse(data));
      } catch {
        compat.onerror?.();
      }
    },
    close: () => {
      if (compat.readyState === WS_READY_STATE.CLOSED) return;
      compat.readyState = WS_READY_STATE.CLOSING;
      socket.disconnect();
      compat.readyState = WS_READY_STATE.CLOSED;
    },
  };

  socket.on("connect", () => {
    compat.readyState = WS_READY_STATE.OPEN;
    compat.onopen?.();
  });

  socket.on("disconnect", (reason) => {
    compat.readyState =
      reason === "io client disconnect"
        ? WS_READY_STATE.CLOSED
        : WS_READY_STATE.CONNECTING;
    compat.onclose?.();
  });

  socket.on("connect_error", () => {
    compat.onerror?.();
  });

  socket.on("signal", (message: unknown) => {
    compat.onmessage?.({ data: JSON.stringify(message) });
  });

  return compat;
}

export function useChat(roomId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [peerIsTyping, setPeerIsTyping] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>({
    isCalling: false,
    isReceiving: false,
    isInCall: false,
    callType: null,
    status: "idle",
    connectionQuality: "idle",
    remoteStream: null,
    localStream: null,
    micMuted: false,
    cameraOff: false,
    cameraFacing: "user",
    error: null,
    startedAt: null,
    durationSec: 0,
  });
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);

  const wsRef = useRef<CompatSocket | null>(null);
  const keyPairRef = useRef<CryptoKeyPair | null>(null);
  const sharedSecretRef = useRef<CryptoKey | null>(null);
  const myPublicKeyBase64Ref = useRef<string | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingOfferRef = useRef<{
    callType: CallType;
    sdp: RTCSessionDescriptionInit;
  } | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingEncryptedMessagesRef = useRef<Array<{ encryptedPayload: string; iv: string; timestamp: number }>>([]);
  const pendingEncryptedCallSignalsRef = useRef<Array<{ encryptedPayload: string; iv: string }>>([]);
  const callStateRef = useRef<CallState>(callState);
  const outgoingCallTimeoutRef = useRef<number | null>(null);
  const incomingAlertIntervalRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const disconnectTimeoutRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const keyRetryIntervalRef = useRef<number | null>(null);
  const ringtoneAudioRef = useRef<HTMLAudioElement | null>(null);
  const dynamicIceServersRef = useRef<RTCIceServer[] | null>(null);
  const dynamicIceServersExpiresAtRef = useRef<number>(0);
  const hasActiveTurnRef = useRef<boolean>(false);
  const callMetaRef = useRef<{
    direction: CallDirection;
    callType: CallType;
    startedAt: number;
    answeredAt: number | null;
  } | null>(null);
  const intentionalDisconnectRef = useRef(false);
  const pendingChunkedMessagesRef = useRef(
    new Map<
      string,
      {
        iv: string;
        timestamp: number;
        total: number;
        chunks: string[];
        updatedAt: number;
      }
    >()
  );

  const env = import.meta.env as Record<string, string | undefined>;

  const parseIceUrls = (value: string | undefined) =>
    (value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  const turnUrls = parseIceUrls(env.VITE_TURN_URLS || env.VITE_TURN_URL);
  const hasValidTurnCredentials = !!(env.VITE_TURN_USERNAME && env.VITE_TURN_CREDENTIAL);
  const hasUsableTurn = turnUrls.length > 0 && hasValidTurnCredentials;
  const configuredIcePolicy = env.VITE_ICE_TRANSPORT_POLICY;
  const preferredIceTransportPolicy: RTCIceTransportPolicy =
    configuredIcePolicy === "relay"
      ? "relay"
      : configuredIcePolicy === "all"
      ? "all"
      : hasUsableTurn
      ? "relay"
      : "all";

  const defaultIceServers: RTCIceServer[] = [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun.cloudflare.com:3478",
      ],
    },
  ];

  useEffect(() => {
    // Only clear messages if joining a different room, not on every reconnect
    // setMessages([]); // <-- Commented out to persist messages across reconnects
    setPeerIsTyping(false);
    setErrorMsg(null);
    setConnectionState("connecting");
  }, [roomId]);

  if (turnUrls.length > 0 && !hasValidTurnCredentials) {
    console.warn("TURN URLs provided but missing VITE_TURN_USERNAME or VITE_TURN_CREDENTIAL. Using STUN only.");
  }

  const staticTurnIceServer: RTCIceServer | null = hasUsableTurn
    ? {
        urls: turnUrls,
        username: env.VITE_TURN_USERNAME,
        credential: env.VITE_TURN_CREDENTIAL,
      }
    : null;

  const serverHasTurnUrl = (server: RTCIceServer) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => typeof url === "string" && (url.startsWith("turn:") || url.startsWith("turns:")));
  };

  const resolveIceServers = useCallback(async (): Promise<RTCIceServer[]> => {
    if (staticTurnIceServer) {
      hasActiveTurnRef.current = true;
      return [...defaultIceServers, staticTurnIceServer];
    }

    const now = Date.now();
    if (
      dynamicIceServersRef.current &&
      dynamicIceServersExpiresAtRef.current > now + 15_000
    ) {
      hasActiveTurnRef.current = dynamicIceServersRef.current.some(serverHasTurnUrl);
      return dynamicIceServersRef.current;
    }

    try {
      const res = await fetch(api.turn.credentials.path);
      if (res.ok) {
        const parsed = api.turn.credentials.responses[200].parse(await res.json());
        const fetched = parsed.iceServers as RTCIceServer[];
        if (fetched.length > 0) {
          const next = [...defaultIceServers, ...fetched];
          dynamicIceServersRef.current = next;
          dynamicIceServersExpiresAtRef.current = parsed.expiresAt;
          hasActiveTurnRef.current = fetched.some(serverHasTurnUrl);
          return next;
        }
      }
    } catch {
      // Fallback to STUN only when TURN provider is unavailable.
    }

    hasActiveTurnRef.current = false;
    return defaultIceServers;
  }, [defaultIceServers, staticTurnIceServer]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    if (!callState.error) return;

    const timeout = window.setTimeout(() => {
      setCallState((prev) => ({ ...prev, error: null }));
    }, 4500);

    return () => window.clearTimeout(timeout);
  }, [callState.error]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();

      for (const [messageId, entry] of Array.from(pendingChunkedMessagesRef.current.entries())) {
        if (now - entry.updatedAt > CHUNKED_MESSAGE_TTL_MS) {
          pendingChunkedMessagesRef.current.delete(messageId);
        }
      }
    }, 30_000);

    return () => window.clearInterval(interval);
  }, []);

  const resetCallState = useCallback(() => {
    setCallState({
      isCalling: false,
      isReceiving: false,
      isInCall: false,
      callType: null,
      status: "idle",
      connectionQuality: "idle",
      remoteStream: null,
      localStream: null,
      micMuted: false,
      cameraOff: false,
      cameraFacing: "user",
      error: null,
      startedAt: null,
      durationSec: 0,
    });
  }, []);

  const clearIncomingAlert = () => {
    if (incomingAlertIntervalRef.current) {
      window.clearInterval(incomingAlertIntervalRef.current);
      incomingAlertIntervalRef.current = null;
    }

    if (navigator.vibrate) {
      navigator.vibrate(0);
    }

    if (ringtoneAudioRef.current) {
      ringtoneAudioRef.current.pause();
      ringtoneAudioRef.current.currentTime = 0;
    }
  };

  const ensureRingtoneAudio = () => {
    if (ringtoneAudioRef.current) return ringtoneAudioRef.current;

    // A tiny embedded ringtone clip (wav data URI) to avoid external asset dependencies.
    const ringtoneDataUri =
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

    const audio = new Audio(ringtoneDataUri);
    audio.loop = false;
    audio.preload = "auto";
    ringtoneAudioRef.current = audio;
    return audio;
  };

  const playRingtoneClip = async () => {
    try {
      const audio = ensureRingtoneAudio();
      audio.currentTime = 0;
      await audio.play();
      return true;
    } catch {
      return false;
    }
  };

  const playIncomingBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.value = 0.05;
      oscillator.connect(gain);
      gain.connect(audioCtx.destination);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.18);
      oscillator.onended = () => audioCtx.close();
    } catch {
      // Browser may block autoplay audio without interaction.
    }
  };

  const startIncomingAlert = () => {
    clearIncomingAlert();

    if (navigator.vibrate) {
      navigator.vibrate([200, 120, 260]);
    }

    playRingtoneClip().then((played) => {
      if (!played) {
        playIncomingBeep();
      }
    });

    incomingAlertIntervalRef.current = window.setInterval(() => {
      if (navigator.vibrate) {
        navigator.vibrate([200, 120, 260]);
      }

      playRingtoneClip().then((played) => {
        if (!played) {
          playIncomingBeep();
        }
      });
    }, 1600);
  };

  const clearDurationTicker = () => {
    if (durationIntervalRef.current) {
      window.clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  };

  const appendCallLog = useCallback(
    async (outcome: CallOutcome) => {
      if (!callMetaRef.current) return;

      const now = Date.now();
      const answeredAt = callMetaRef.current.answeredAt;
      const durationSec = answeredAt ? Math.max(0, Math.floor((now - answeredAt) / 1000)) : 0;

      const log: CallLog = {
        id: `call-${now}-${Math.random().toString(36).slice(2, 8)}`,
        roomId,
        direction: callMetaRef.current.direction,
        callType: callMetaRef.current.callType,
        outcome,
        startedAt: callMetaRef.current.startedAt,
        endedAt: now,
        durationSec,
      };

      setCallLogs((prev) => {
        const next = [log, ...prev].slice(0, 100);
        return next;
      });

      try {
        const url = buildUrl(api.rooms.callLogs.create.path, { id: roomId });
        await fetch(url, {
          method: api.rooms.callLogs.create.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(log),
        });
      } catch {
        // Keep local state even if API call fails.
      }

      callMetaRef.current = null;
    },
    [roomId]
  );

  const clearOutgoingCallTimeout = () => {
    if (outgoingCallTimeoutRef.current) {
      window.clearTimeout(outgoingCallTimeoutRef.current);
      outgoingCallTimeoutRef.current = null;
    }
  };

  const clearHeartbeat = () => {
    if (heartbeatIntervalRef.current) {
      window.clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  };

  const clearKeyRetry = () => {
    if (keyRetryIntervalRef.current) {
      window.clearInterval(keyRetryIntervalRef.current);
      keyRetryIntervalRef.current = null;
    }
  };

  const stopStream = (stream: MediaStream | null) => {
    stream?.getTracks().forEach((track) => track.stop());
  };

  const flushPendingIceCandidates = useCallback(async (pc: RTCPeerConnection) => {
    if (!pc.remoteDescription || pendingIceCandidatesRef.current.length === 0) {
      return;
    }

    const queued = [...pendingIceCandidatesRef.current];
    pendingIceCandidatesRef.current = [];

    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore stale/invalid candidates.
      }
    }
  }, []);

  const cleanupCall = useCallback(
    (resetState = true, notice?: string) => {
      if (pcRef.current) {
        pcRef.current.onicecandidate = null;
        pcRef.current.ontrack = null;
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.close();
        pcRef.current = null;
      }

      stopStream(localStreamRef.current);
      stopStream(remoteStreamRef.current);

      localStreamRef.current = null;
      remoteStreamRef.current = null;
      pendingOfferRef.current = null;
      pendingIceCandidatesRef.current = [];
      clearOutgoingCallTimeout();
      clearIncomingAlert();
      clearDurationTicker();
      clearKeyRetry();

      if (resetState) {
        resetCallState();

        if (notice) {
          setCallState((prev) => ({ ...prev, error: notice }));
        }
      }
    },
    [resetCallState]
  );

  const sendEncryptedCallSignal = useCallback(
    async (signal: SignalPayload) => {
      if (
        !wsRef.current ||
        wsRef.current.readyState !== WS_READY_STATE.OPEN
      ) {
        return false;
      }

      wsRef.current.send(
        JSON.stringify({
          type: "callSignalPlain",
          payload: { roomId, signal },
        })
      );

      return true;
    },
    [roomId]
  );

  const createPeerConnection = useCallback(async () => {
    const resolvedIceServers = await resolveIceServers();
    const effectiveIceTransportPolicy: RTCIceTransportPolicy =
      preferredIceTransportPolicy === "relay" && !hasActiveTurnRef.current
        ? "all"
        : preferredIceTransportPolicy;

    const pc = new RTCPeerConnection({
      iceServers: resolvedIceServers,
      iceTransportPolicy: effectiveIceTransportPolicy,
      iceCandidatePoolSize: 8,
    });

    const updateQuality = (state: RTCPeerConnectionState) => {
      setCallState((prev) => ({
        ...prev,
        connectionQuality:
          state === "connected"
            ? "good"
            : state === "connecting" || state === "new"
            ? "connecting"
            : state === "disconnected"
            ? "degraded"
            : state === "failed" || state === "closed"
            ? "lost"
            : prev.connectionQuality,
      }));
    };

    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await sendEncryptedCallSignal({
          kind: "ice-candidate",
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const [incomingStream] = event.streams;

      if (incomingStream) {
        remoteStreamRef.current = incomingStream;
        setCallState((prev) => ({ ...prev, remoteStream: incomingStream }));
        return;
      }

      // Some browsers/devices emit tracks without event.streams populated.
      if (!event.track) {
        return;
      }

      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
        setCallState((prev) => ({ ...prev, remoteStream: remoteStreamRef.current }));
      }

      const alreadyExists = remoteStreamRef.current
        .getTracks()
        .some((track) => track.id === event.track.id);

      if (!alreadyExists) {
        remoteStreamRef.current.addTrack(event.track);
        setCallState((prev) => ({ ...prev, remoteStream: remoteStreamRef.current }));
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      updateQuality(state);

      if (state === "connected") {
        clearOutgoingCallTimeout();
        if (disconnectTimeoutRef.current) {
          window.clearTimeout(disconnectTimeoutRef.current);
          disconnectTimeoutRef.current = null;
        }

        if (callMetaRef.current && !callMetaRef.current.answeredAt) {
          callMetaRef.current.answeredAt = Date.now();
        }

        clearDurationTicker();
        durationIntervalRef.current = window.setInterval(() => {
          const answeredAt = callMetaRef.current?.answeredAt;
          if (!answeredAt) return;
          const durationSec = Math.max(0, Math.floor((Date.now() - answeredAt) / 1000));
          setCallState((prev) => ({ ...prev, durationSec }));
        }, 1000);

        setCallState((prev) => ({
          ...prev,
          isCalling: false,
          isReceiving: false,
          isInCall: true,
          status: "active",
          startedAt: callMetaRef.current?.answeredAt ?? Date.now(),
        }));
      }

      if (state === "disconnected") {
        if (!disconnectTimeoutRef.current) {
          disconnectTimeoutRef.current = window.setTimeout(() => {
            const currentState = pc.connectionState;
            if (currentState === "disconnected") {
              appendCallLog("failed");
              const callDropMessage = !hasActiveTurnRef.current
                ? "Call connection lost. Add TURN server config for cross-network device support."
                : "Call connection lost.";
              cleanupCall(true, callDropMessage);
            }
          }, 5000);
        }
      }

      if (state === "failed" || state === "closed") {
        if (disconnectTimeoutRef.current) {
          window.clearTimeout(disconnectTimeoutRef.current);
          disconnectTimeoutRef.current = null;
        }

        appendCallLog("failed");
        const callDropMessage = !hasActiveTurnRef.current
          ? "Call connection lost. Add TURN server config for cross-network device support."
          : "Call connection lost.";
        cleanupCall(true, callDropMessage);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      setCallState((prev) => ({
        ...prev,
        connectionQuality:
          state === "connected" || state === "completed"
            ? "good"
            : state === "checking"
            ? "connecting"
            : state === "disconnected"
            ? "degraded"
            : state === "failed" || state === "closed"
            ? "lost"
            : prev.connectionQuality,
      }));
    };

    pcRef.current = pc;
    return pc;
  }, [appendCallLog, cleanupCall, preferredIceTransportPolicy, resolveIceServers, sendEncryptedCallSignal]);

  const getMediaErrorMessage = (error: unknown) => {
    if (!(error instanceof DOMException)) {
      return "Could not access microphone/camera.";
    }

    if (error.name === "NotAllowedError") {
      return "Microphone/camera permission denied. Allow access in browser settings.";
    }

    if (error.name === "NotFoundError") {
      return "No microphone/camera device found on this device.";
    }

    if (error.name === "NotReadableError") {
      return "Microphone/camera is currently in use by another app.";
    }

    return "Could not access microphone/camera.";
  };

  const acquireLocalStream = useCallback(
    async (callType: CallType, facingMode: "user" | "environment" = "user") => {
      return navigator.mediaDevices.getUserMedia({
        audio: true,
        video:
          callType === "video"
            ? {
                facingMode: { ideal: facingMode },
              }
            : false,
      });
    },
    []
  );

  const buildSwitchCameraConstraints = useCallback(
    async (targetFacing: "user" | "environment", currentDeviceId?: string) => {
      const fallback = {
        facingMode: { exact: targetFacing },
      } as MediaTrackConstraints;

      if (!navigator.mediaDevices?.enumerateDevices) {
        return fallback;
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((device) => device.kind === "videoinput");

        const matchingByLabel = videoInputs.find((device) => {
          if (!device.deviceId || device.deviceId === currentDeviceId) {
            return false;
          }

          const label = device.label.toLowerCase();
          return targetFacing === "environment"
            ? /back|rear|environment/.test(label)
            : /front|user|facetime/.test(label);
        });

        if (matchingByLabel?.deviceId) {
          return { deviceId: { exact: matchingByLabel.deviceId } } as MediaTrackConstraints;
        }

        const alternateDevice = videoInputs.find(
          (device) => device.deviceId && device.deviceId !== currentDeviceId
        );

        if (alternateDevice?.deviceId) {
          return { deviceId: { exact: alternateDevice.deviceId } } as MediaTrackConstraints;
        }
      } catch {
        // Fall back to facingMode when device enumeration is unavailable or blocked.
      }

      return fallback;
    },
    []
  );

  const handleEncryptedMessagePayload = useCallback(async (data: {
    encryptedPayload: string;
    iv: string;
    timestamp: number;
  }) => {
    console.log('[DEBUG] Received encrypted message payload:', data);
    if (!sharedSecretRef.current) {
      console.warn('[DEBUG] No shared secret, queuing message:', data);
      pendingEncryptedMessagesRef.current.push(data);
      return;
    }

    let decryptedJson;
    try {
      decryptedJson = await decryptMessage(
        data.encryptedPayload,
        data.iv,
        sharedSecretRef.current
      );
      console.log('[DEBUG] Decrypted message JSON:', decryptedJson);
    } catch (err) {
      console.error('[DEBUG] Failed to decrypt message:', err, data);
      return;
    }

    let innerPayload;
    try {
      innerPayload = JSON.parse(decryptedJson);
      console.log('[DEBUG] Parsed inner payload:', innerPayload);
    } catch (err) {
      console.error('[DEBUG] Failed to parse decrypted JSON:', err, decryptedJson);
      return;
    }

    const expiresAt = innerPayload.destructTimer
      ? Date.now() + innerPayload.destructTimer * 1000
      : null;

    const newMessage: ChatMessage = {
      id: `${data.timestamp}-${Math.random().toString(36).substring(7)}`,
      text: innerPayload.text,
      image: innerPayload.image,
      file: innerPayload.file,
      isMine: false,
      timestamp: data.timestamp,
      expiresAt,
    };

    console.log('[DEBUG] Adding new message to chat:', newMessage);
    setMessages((prev) => [...prev, newMessage]);
  }, []);

  const handleEncryptedMessageChunk = useCallback(
    async (data: {
      messageId: string;
      encryptedChunk: string;
      iv: string;
      index: number;
      total: number;
      timestamp: number;
    }) => {
      const existing = pendingChunkedMessagesRef.current.get(data.messageId);
      const next =
        existing ??
        {
          iv: data.iv,
          timestamp: data.timestamp,
          total: data.total,
          chunks: Array<string>(data.total).fill(""),
          updatedAt: Date.now(),
        };

      if (data.index < 0 || data.index >= data.total || next.total !== data.total) {
        pendingChunkedMessagesRef.current.delete(data.messageId);
        return;
      }

      next.iv = data.iv;
      next.timestamp = data.timestamp;
      next.updatedAt = Date.now();
      next.chunks[data.index] = data.encryptedChunk;
      pendingChunkedMessagesRef.current.set(data.messageId, next);

      if (next.chunks.some((chunk) => chunk.length === 0)) {
        return;
      }

      pendingChunkedMessagesRef.current.delete(data.messageId);
      await handleEncryptedMessagePayload({
        encryptedPayload: next.chunks.join(""),
        iv: next.iv,
        timestamp: next.timestamp,
      });
    },
    [handleEncryptedMessagePayload]
  );

  const handleCallSignal = useCallback(async (signal: SignalPayload) => {
    if (signal.kind === "call-offer") {
      if (
        callStateRef.current.isInCall ||
        callStateRef.current.isReceiving ||
        callStateRef.current.isCalling
      ) {
        await sendEncryptedCallSignal({ kind: "call-reject" });
        return;
      }

      pendingOfferRef.current = {
        callType: signal.callType,
        sdp: signal.sdp,
      };

      callMetaRef.current = {
        direction: "incoming",
        callType: signal.callType,
        startedAt: Date.now(),
        answeredAt: null,
      };

      if (document.hidden || !document.hasFocus()) {
        showToast({
          title: "Incoming call",
          description: `${signal.callType === "video" ? "Video" : "Voice"} call in room ${roomId}`,
        });
      }

      startIncomingAlert();

      setCallState((prev) => ({
        ...prev,
        isReceiving: true,
        isCalling: false,
        isInCall: false,
        callType: signal.callType,
        status: "incoming",
        startedAt: Date.now(),
        durationSec: 0,
      }));
      return;
    }

    if (signal.kind === "call-answer") {
      if (pcRef.current) {
        clearOutgoingCallTimeout();

        await pcRef.current.setRemoteDescription(signal.sdp);

        await flushPendingIceCandidates(pcRef.current);

        setCallState((prev) => ({
          ...prev,
          isCalling: false,
          isInCall: true,
          status: "active",
        }));
      }
      return;
    }

    if (signal.kind === "ice-candidate") {
      if (!pcRef.current) {
        // Candidate can arrive before peer connection exists (common on mobile/slow devices).
        pendingIceCandidatesRef.current.push(signal.candidate);
        return;
      }

      if (pcRef.current.remoteDescription) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch {
          // Ignore invalid/stale candidates from transport race conditions.
        }
      } else {
        pendingIceCandidatesRef.current.push(signal.candidate);
      }
      return;
    }

    if (signal.kind === "call-end") {
      const outcome = callStateRef.current.status === "incoming" ? "missed" : callStateRef.current.status === "active" ? "completed" : "cancelled";
      appendCallLog(outcome);

      if (outcome === "missed" && (document.hidden || !document.hasFocus())) {
        showToast({
          title: "Missed call",
          description: `Missed ${callStateRef.current.callType || "voice"} call in room ${roomId}`,
        });
      }

      cleanupCall(true, "Call ended.");
      return;
    }

    if (signal.kind === "call-reject") {
      appendCallLog("rejected");
      cleanupCall(true, "Call declined by peer.");
    }
  }, [appendCallLog, cleanupCall, flushPendingIceCandidates, roomId, sendEncryptedCallSignal]);

  // Auto-delete expired messages
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      setMessages((prev) => {
        const filtered = prev.filter(
          (msg) => msg.expiresAt === null || msg.expiresAt > now
        );
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadCallLogs = async () => {
      try {
        const url = buildUrl(api.rooms.callLogs.list.path, { id: roomId });
        const res = await fetch(url);
        if (!res.ok) return;
        const parsed = api.rooms.callLogs.list.responses[200].parse(await res.json());
        setCallLogs(parsed);
      } catch {
        setCallLogs([]);
      }
    };

    loadCallLogs();
  }, [roomId]);

  const connect = useCallback(async () => {
    if (wsRef.current) return;

    try {
      intentionalDisconnectRef.current = false;
      if (!window.isSecureContext) {
        setConnectionState("error");
        setErrorMsg(
          "Secure context required. Open this app over HTTPS (or localhost) to use encrypted chat and calling."
        );
        return;
      }

      setConnectionState("generating_keys");

      const keyPair = await generateKeyPair();
      keyPairRef.current = keyPair;

      myPublicKeyBase64Ref.current = await exportPublicKey(keyPair.publicKey);

      const ws = createSocketIoCompatSocket();
      wsRef.current = ws;
      let hasConnectedOnce = false;

      ws.onopen = () => {
        hasConnectedOnce = true;
        setErrorMsg(null);
        setConnectionState("waiting_for_peer");

        clearHeartbeat();
        clearKeyRetry();
        heartbeatIntervalRef.current = window.setInterval(() => {
          if (ws.readyState !== WS_READY_STATE.OPEN) return;
          ws.send(JSON.stringify({ type: "ping", payload: { ts: Date.now() } }));
        }, 20_000);

        ws.send(
          JSON.stringify({
            type: "join",
            payload: { roomId },
          })
        );

        keyRetryIntervalRef.current = window.setInterval(() => {
          if (
            ws.readyState !== WS_READY_STATE.OPEN ||
            !myPublicKeyBase64Ref.current ||
            sharedSecretRef.current
          ) {
            return;
          }

          ws.send(
            JSON.stringify({
              type: "publicKey",
              payload: { roomId, publicKey: myPublicKeyBase64Ref.current },
            })
          );
        }, 3000);
      };

      ws.onclose = () => {
        clearHeartbeat();
        clearKeyRetry();
        setConnectionState("disconnected");
        sharedSecretRef.current = null;
        setPeerIsTyping(false);

        if (intentionalDisconnectRef.current) {
          wsRef.current = null;
        }

        const hasActiveOrPendingCall =
          callStateRef.current.isInCall ||
          callStateRef.current.isCalling ||
          callStateRef.current.isReceiving;

        if (!hasActiveOrPendingCall) {
          cleanupCall(true);
          return;
        }

        setCallState((prev) => ({
          ...prev,
          error: "Signaling disconnected. Call can continue, but reconnect to sync controls.",
        }));
      };

      ws.onerror = () => {
        if (hasConnectedOnce) {
          setConnectionState((prev) => (prev === "secured" ? prev : "connecting"));
          return;
        }

        setConnectionState("connecting");
      };

      ws.onmessage = async (event) => {
        try {
          const parsed = JSON.parse(event.data);

          if (parsed.type === "joined") {
            const data = wsEvents.receive.joined.parse(parsed.payload);

            ws.send(
              JSON.stringify({
                type: "publicKey",
                payload: {
                  roomId: data.roomId,
                  publicKey: myPublicKeyBase64Ref.current,
                },
              })
            );
          }

          else if (parsed.type === "userJoined") {
            const data = wsEvents.receive.userJoined.parse(parsed.payload);

            if (data.clientsCount > 1) {
              ws.send(
                JSON.stringify({
                  type: "publicKey",
                  payload: {
                    roomId,
                    publicKey: myPublicKeyBase64Ref.current,
                  },
                })
              );
            }
          }

          else if (parsed.type === "publicKey") {
            const data = wsEvents.receive.publicKey.parse(parsed.payload);

            if (
              keyPairRef.current &&
              data.publicKey !== myPublicKeyBase64Ref.current
            ) {
              const peerKey = await importPublicKey(data.publicKey);

              const secret = await deriveSecret(
                keyPairRef.current.privateKey,
                peerKey
              );

              sharedSecretRef.current = secret;
              clearKeyRetry();

              setConnectionState("secured");

              if (pendingEncryptedMessagesRef.current.length > 0) {
                const queuedMessages = [...pendingEncryptedMessagesRef.current];
                pendingEncryptedMessagesRef.current = [];

                for (const queuedMessage of queuedMessages) {
                  try {
                    await handleEncryptedMessagePayload(queuedMessage);
                  } catch {
                    // Ignore malformed queued messages.
                  }
                }
              }

              if (pendingEncryptedCallSignalsRef.current.length > 0) {
                const queuedSignals = [...pendingEncryptedCallSignalsRef.current];
                pendingEncryptedCallSignalsRef.current = [];

                for (const queued of queuedSignals) {
                  try {
                    const decryptedSignal = await decryptMessage(
                      queued.encryptedPayload,
                      queued.iv,
                      sharedSecretRef.current
                    );

                    const signal = JSON.parse(decryptedSignal) as SignalPayload;
                    await handleCallSignal(signal);
                  } catch {
                    // Ignore malformed queued signals.
                  }
                }
              }
            }
          }

          else if (parsed.type === "message") {
            const data = wsEvents.receive.message.parse(parsed.payload);
            await handleEncryptedMessagePayload(data);
          }

          else if (parsed.type === "messageChunk") {
            const data = wsEvents.receive.messageChunk.parse(parsed.payload);
            await handleEncryptedMessageChunk(data);
          }

          else if (parsed.type === "typing") {
            const data = wsEvents.receive.typing.parse(parsed.payload);
            setPeerIsTyping(data.isTyping);
          }

          else if (parsed.type === "callSignal") {
            const data = wsEvents.receive.callSignal.parse(parsed.payload);

            if (!sharedSecretRef.current) {
              pendingEncryptedCallSignalsRef.current.push({
                encryptedPayload: data.encryptedPayload,
                iv: data.iv,
              });
              return;
            }

            const decryptedSignal = await decryptMessage(
              data.encryptedPayload,
              data.iv,
              sharedSecretRef.current
            );

            const signal = JSON.parse(decryptedSignal) as SignalPayload;
            await handleCallSignal(signal);
          }

          else if (parsed.type === "callSignalPlain") {
            const signal = parsed?.payload?.signal as SignalPayload | undefined;
            if (!signal || typeof signal !== "object" || typeof (signal as any).kind !== "string") {
              return;
            }
            await handleCallSignal(signal);
          }

          else if (parsed.type === "pong") {
            return;
          }

          else if (parsed.type === "userLeft") {
            setConnectionState("waiting_for_peer");
            sharedSecretRef.current = null;
            setPeerIsTyping(false);
            cleanupCall(true);
          }

          else if (parsed.type === "error") {
            const data = wsEvents.receive.error.parse(parsed.payload);
            setErrorMsg(data.message);
            setConnectionState("error");
          }

        } catch (err) {
          console.error("Failed to handle WS message", err);
        }
      };
    } catch (err) {
      console.error("Crypto init failed", err);
      setConnectionState("error");
      setErrorMsg("Failed to initialize encryption");
    }
  }, [cleanupCall, handleCallSignal, handleEncryptedMessageChunk, handleEncryptedMessagePayload, roomId]);

  useEffect(() => {
    connect();

    return () => {
      clearHeartbeat();
      clearKeyRetry();

      if (wsRef.current) {
        intentionalDisconnectRef.current = true;
        cleanupCall(false);

        wsRef.current.send(
          JSON.stringify({
            type: "leave",
            payload: { roomId },
          })
        );

        wsRef.current.close();
      }
    };
  }, [cleanupCall, connect, roomId]);

  const sendMessage = async (
    content: {
      text?: string;
      image?: string;
      file?: {
        name: string;
        mimeType: string;
        size: number;
        dataUrl: string;
      };
    },
    destructTimer: number | null
  ) => {
    if (
      !wsRef.current ||
      !sharedSecretRef.current ||
      wsRef.current.readyState !== WS_READY_STATE.OPEN
    ) {
      return false;
    }

    try {
      const innerPayload = JSON.stringify({ ...content, destructTimer });

      const { encryptedPayload, iv } = await encryptMessage(
        innerPayload,
        sharedSecretRef.current
      );

      const expiresAt = destructTimer
        ? Date.now() + destructTimer * 1000
        : null;

      const addLocalMessage = () => {
        setMessages((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}`,
            ...content,
            isMine: true,
            timestamp: Date.now(),
            expiresAt,
          },
        ]);
      };

      const serializedLength = JSON.stringify({
        type: "message",
        payload: { roomId, encryptedPayload, iv },
      }).length;

      if (serializedLength > CHUNKED_MESSAGE_SIZE) {
        const chunks =
          encryptedPayload.match(new RegExp(`.{1,${CHUNKED_MESSAGE_SIZE}}`, "g")) ?? [];
        const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const timestamp = Date.now();

        for (let index = 0; index < chunks.length; index += 1) {
          if (
            !wsRef.current ||
            wsRef.current.readyState !== WS_READY_STATE.OPEN
          ) {
            return false;
          }

          wsRef.current.send(
            JSON.stringify({
              type: "messageChunk",
              payload: {
                roomId,
                messageId,
                encryptedChunk: chunks[index],
                iv,
                index,
                total: chunks.length,
                timestamp,
              },
            })
          );
        }
      } else {
        wsRef.current.send(
          JSON.stringify({
            type: "message",
            payload: { roomId, encryptedPayload, iv },
          })
        );
      }

      addLocalMessage();

      return true;
    } catch (err) {
      console.error("Failed to send encrypted message", err);
      return false;
    }
  };

  const sendTypingStatus = (isTyping: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WS_READY_STATE.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "typing",
          payload: { roomId, isTyping },
        })
      );
    }
  };

  const startCall = async (callType: CallType) => {
    if (connectionState !== "secured") return false;
    if (callState.isCalling || callState.isReceiving || callState.isInCall) return false;

    if (!navigator.mediaDevices?.getUserMedia) {
      setCallState((prev) => ({
        ...prev,
        error: "This device/browser does not support WebRTC media calls.",
      }));
      return false;
    }

    try {
      setCallState((prev) => ({ ...prev, error: null }));

      callMetaRef.current = {
        direction: "outgoing",
        callType,
        startedAt: Date.now(),
        answeredAt: null,
      };

      const localStream = await acquireLocalStream(callType, "user");

      localStreamRef.current = localStream;

      setCallState((prev) => ({
        ...prev,
        isCalling: true,
        isReceiving: false,
        isInCall: false,
        callType,
        status: "outgoing",
        localStream,
        remoteStream: null,
        micMuted: false,
        cameraOff: callType === "audio",
        cameraFacing: "user",
        error: null,
        startedAt: Date.now(),
        durationSec: 0,
      }));

      const pc = await createPeerConnection();

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await sendEncryptedCallSignal({
        kind: "call-offer",
        callType,
        sdp: offer,
      });

      outgoingCallTimeoutRef.current = window.setTimeout(async () => {
        if (callStateRef.current.status === "outgoing") {
          await sendEncryptedCallSignal({ kind: "call-end" });
          appendCallLog("missed");
          cleanupCall(true, "No answer. Call timed out.");
        }
      }, 45000);

      return true;
    } catch (err) {
      console.error("Failed to start call", err);
      setCallState((prev) => ({ ...prev, error: getMediaErrorMessage(err) }));
      cleanupCall(true);
      return false;
    }
  };

  const acceptCall = async () => {
    if (!pendingOfferRef.current) return false;

    try {
      setCallState((prev) => ({ ...prev, error: null }));

      const offer = pendingOfferRef.current;
      clearIncomingAlert();

      const localStream = await acquireLocalStream(offer.callType, "user");

      localStreamRef.current = localStream;

      setCallState((prev) => ({
        ...prev,
        isReceiving: false,
        isCalling: false,
        isInCall: true,
        status: "connecting",
        callType: offer.callType,
        localStream,
        remoteStream: null,
        micMuted: false,
        cameraOff: offer.callType === "audio",
        cameraFacing: "user",
        error: null,
        startedAt: Date.now(),
        durationSec: 0,
      }));

      if (callMetaRef.current) {
        callMetaRef.current.answeredAt = Date.now();
      }

      const pc = await createPeerConnection();

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

        await pc.setRemoteDescription(offer.sdp);
      await flushPendingIceCandidates(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await sendEncryptedCallSignal({
        kind: "call-answer",
        sdp: answer,
      });

      pendingOfferRef.current = null;
      return true;
    } catch (err) {
      console.error("Failed to accept call", err);
      setCallState((prev) => ({ ...prev, error: getMediaErrorMessage(err) }));
      cleanupCall(true);
      return false;
    }
  };

  const rejectCall = async () => {
    await sendEncryptedCallSignal({ kind: "call-reject" });
    appendCallLog("rejected");
    cleanupCall(true, "Call declined.");
  };

  const endCall = async () => {
    await sendEncryptedCallSignal({ kind: "call-end" });
    appendCallLog(callStateRef.current.status === "active" ? "completed" : "cancelled");
    setCallState((prev) => ({ ...prev, error: null }));
    cleanupCall(true);
  };

  const clearCallLogs = async () => {
    setCallLogs([]);

    try {
      const url = buildUrl(api.rooms.callLogs.clear.path, { id: roomId });
      await fetch(url, { method: api.rooms.callLogs.clear.method });
    } catch {
      // Ignore network failures; local state is already cleared.
    }
  };

  const toggleMic = () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextMuted = !callState.micMuted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });

    setCallState((prev) => ({ ...prev, micMuted: nextMuted }));
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream || callState.callType !== "video") return;

    const nextCameraOff = !callState.cameraOff;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = !nextCameraOff;
    });

    setCallState((prev) => ({ ...prev, cameraOff: nextCameraOff }));
  };

  const switchCamera = async () => {
    const currentStream = localStreamRef.current;
    const currentCall = callStateRef.current;

    if (!currentStream || currentCall.callType !== "video" || !pcRef.current) {
      return false;
    }

    const nextFacing = currentCall.cameraFacing === "environment" ? "user" : "environment";

    try {
      const currentVideoTrack = currentStream.getVideoTracks()[0];
      if (!currentVideoTrack) {
        return false;
      }

      try {
        await currentVideoTrack.applyConstraints({
          facingMode: { exact: nextFacing },
        } as MediaTrackConstraints);

        setCallState((prev) => ({
          ...prev,
          cameraFacing: nextFacing,
          localStream: currentStream,
        }));

        return true;
      } catch {
        const currentDeviceId = currentVideoTrack.getSettings().deviceId;
        const nextVideoConstraints = await buildSwitchCameraConstraints(
          nextFacing,
          currentDeviceId
        );

        // Many mobile devices cannot open the second camera while the first is still active.
        currentStream.removeTrack(currentVideoTrack);
        currentVideoTrack.stop();

        const replacementStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: nextVideoConstraints,
        });

        const nextVideoTrack = replacementStream.getVideoTracks()[0];
        if (!nextVideoTrack) {
          throw new Error("No video track available.");
        }

        nextVideoTrack.enabled = !currentCall.cameraOff;

        const sender = pcRef.current
          .getSenders()
          .find((item) => item.track?.kind === "video");

        if (!sender) {
          replacementStream.getTracks().forEach((track) => track.stop());
          return false;
        }

        await sender.replaceTrack(nextVideoTrack);

        currentStream.addTrack(nextVideoTrack);

        localStreamRef.current = currentStream;

        setCallState((prev) => ({
          ...prev,
          localStream: currentStream,
          cameraFacing: nextFacing,
        }));

        return true;
      }
    } catch (err) {
      console.error("Failed to switch camera", err);
      setCallState((prev) => ({
        ...prev,
        error: "Could not switch camera on this device.",
      }));
      return false;
    }
  };

  return {
    messages,
    connectionState,
    peerIsTyping,
    errorMsg,
    callState,
    callLogs,
    sendMessage,
    sendTypingStatus,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMic,
    toggleCamera,
    switchCamera,
    clearCallLogs,
  };
}
