import { useState, useEffect, useRef, useCallback } from "react";
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
    error: null,
    startedAt: null,
    durationSec: 0,
  });
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
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
  const callStateRef = useRef<CallState>(callState);
  const outgoingCallTimeoutRef = useRef<number | null>(null);
  const incomingAlertIntervalRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const disconnectTimeoutRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const ringtoneAudioRef = useRef<HTMLAudioElement | null>(null);
  const callMetaRef = useRef<{
    direction: CallDirection;
    callType: CallType;
    startedAt: number;
    answeredAt: number | null;
  } | null>(null);

  const env = import.meta.env as Record<string, string | undefined>;

  const parseIceUrls = (value: string | undefined) =>
    (value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  const turnUrls = parseIceUrls(env.VITE_TURN_URLS || env.VITE_TURN_URL);
  const configuredIcePolicy = env.VITE_ICE_TRANSPORT_POLICY;
  const iceTransportPolicy: RTCIceTransportPolicy =
    configuredIcePolicy === "relay"
      ? "relay"
      : configuredIcePolicy === "all"
      ? "all"
      : turnUrls.length > 0
      ? "relay"
      : "all";

  const iceServers: RTCIceServer[] = [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun.cloudflare.com:3478",
      ],
    },
  ];

  useEffect(() => {
    setMessages([]);
    setPeerIsTyping(false);
    setErrorMsg(null);
    setConnectionState("connecting");
  }, [roomId]);

  if (turnUrls.length > 0) {
    iceServers.push({
      urls: turnUrls,
      username: env.VITE_TURN_USERNAME,
      credential: env.VITE_TURN_CREDENTIAL,
    });
  }

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
        !sharedSecretRef.current ||
        wsRef.current.readyState !== WebSocket.OPEN
      ) {
        return false;
      }

      const payload = JSON.stringify(signal);
      const { encryptedPayload, iv } = await encryptMessage(
        payload,
        sharedSecretRef.current
      );

      wsRef.current.send(
        JSON.stringify({
          type: "callSignal",
          payload: { roomId, encryptedPayload, iv },
        })
      );

      return true;
    },
    [roomId]
  );

  const createPeerConnection = useCallback(() => {
    pendingIceCandidatesRef.current = [];

    const pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy,
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
              const callDropMessage = turnUrls.length === 0
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
        const callDropMessage = turnUrls.length === 0
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
  }, [appendCallLog, cleanupCall, iceServers, iceTransportPolicy, sendEncryptedCallSignal, turnUrls.length]);

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

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host || "localhost:5000";

      const wsUrl = `${protocol}//${host}/ws`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionState("waiting_for_peer");

        clearHeartbeat();
        heartbeatIntervalRef.current = window.setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: "ping", payload: { ts: Date.now() } }));
        }, 20_000);

        ws.send(
          JSON.stringify({
            type: "join",
            payload: { roomId },
          })
        );

        ws.send(
          JSON.stringify({
            type: "publicKey",
            payload: { roomId, publicKey: myPublicKeyBase64Ref.current },
          })
        );
      };

      ws.onclose = () => {
        clearHeartbeat();
        setConnectionState("disconnected");
        wsRef.current = null;
        sharedSecretRef.current = null;
        setPeerIsTyping(false);

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
        setConnectionState("error");
        setErrorMsg("WebSocket connection failed");
      };

      ws.onmessage = async (event) => {
        try {
          const parsed = JSON.parse(event.data);

          if (parsed.type === "userJoined") {
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

              setConnectionState("secured");
            }
          }

          else if (parsed.type === "message") {
            const data = wsEvents.receive.message.parse(parsed.payload);

            if (!sharedSecretRef.current) return;

            const decryptedJson = await decryptMessage(
              data.encryptedPayload,
              data.iv,
              sharedSecretRef.current
            );

            const innerPayload = JSON.parse(decryptedJson);

            const expiresAt = innerPayload.destructTimer
              ? Date.now() + innerPayload.destructTimer * 1000
              : null;

            const newMessage: ChatMessage = {
              id: `${data.timestamp}-${Math.random()
                .toString(36)
                .substring(7)}`,
              text: innerPayload.text,
              image: innerPayload.image,
              isMine: false,
              timestamp: data.timestamp,
              expiresAt,
            };

            setMessages((prev) => [...prev, newMessage]);
          }

          else if (parsed.type === "typing") {
            const data = wsEvents.receive.typing.parse(parsed.payload);
            setPeerIsTyping(data.isTyping);
          }

          else if (parsed.type === "callSignal") {
            const data = wsEvents.receive.callSignal.parse(parsed.payload);

            if (!sharedSecretRef.current) return;

            const decryptedSignal = await decryptMessage(
              data.encryptedPayload,
              data.iv,
              sharedSecretRef.current
            );

            const signal = JSON.parse(decryptedSignal) as SignalPayload;

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
            }

            else if (signal.kind === "call-answer") {
              if (pcRef.current) {
                clearOutgoingCallTimeout();

                await pcRef.current.setRemoteDescription(
                  new RTCSessionDescription(signal.sdp)
                );

                await flushPendingIceCandidates(pcRef.current);

                setCallState((prev) => ({
                  ...prev,
                  isCalling: false,
                  isInCall: true,
                  status: "active",
                }));
              }
            }

            else if (signal.kind === "ice-candidate") {
              if (pcRef.current) {
                if (pcRef.current.remoteDescription) {
                  await pcRef.current.addIceCandidate(
                    new RTCIceCandidate(signal.candidate)
                  );
                } else {
                  pendingIceCandidatesRef.current.push(signal.candidate);
                }
              }
            }

            else if (signal.kind === "call-end") {
              const outcome = callStateRef.current.status === "incoming" ? "missed" : callStateRef.current.status === "active" ? "completed" : "cancelled";
              appendCallLog(outcome);

              if (outcome === "missed" && (document.hidden || !document.hasFocus())) {
                showToast({
                  title: "Missed call",
                  description: `Missed ${callStateRef.current.callType || "voice"} call in room ${roomId}`,
                });
              }

              cleanupCall(true, "Call ended.");
            }

            else if (signal.kind === "call-reject") {
              appendCallLog("rejected");
              cleanupCall(true, "Call declined by peer.");
            }
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
  }, [cleanupCall, flushPendingIceCandidates, roomId, sendEncryptedCallSignal]);

  useEffect(() => {
    connect();

    return () => {
      clearHeartbeat();

      if (wsRef.current) {
        cleanupCall(false);

        wsRef.current.send(
        pcRef.current.oniceconnectionstatechange = null;
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
    content: { text?: string; image?: string },
    destructTimer: number | null
  ) => {
    if (
      !wsRef.current ||
      !sharedSecretRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN
    ) {
      return false;
    }

    try {
      const innerPayload = JSON.stringify({ ...content, destructTimer });

      const { encryptedPayload, iv } = await encryptMessage(
        innerPayload,
        sharedSecretRef.current
      );

      wsRef.current.send(
        JSON.stringify({
          type: "message",
          payload: { roomId, encryptedPayload, iv },
        })
      );

      const expiresAt = destructTimer
        ? Date.now() + destructTimer * 1000
        : null;

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

      return true;
    } catch (err) {
      console.error("Failed to send encrypted message", err);
      return false;
    }
  };

  const sendTypingStatus = (isTyping: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
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

      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === "video",
      });

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
        error: null,
        startedAt: Date.now(),
        durationSec: 0,
      }));

      const pc = createPeerConnection();

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

      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: offer.callType === "video",
      });

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
        error: null,
        startedAt: Date.now(),
        durationSec: 0,
      }));

      if (callMetaRef.current) {
        callMetaRef.current.answeredAt = Date.now();
      }

      const pc = createPeerConnection();

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));
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
    clearCallLogs,
  };
}