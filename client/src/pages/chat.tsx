import { useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  ArrowLeft,
  Copy,
  CheckCircle2,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Phone,
  Video,
  PhoneOff,
  Mic,
  MicOff,
  VideoOff,
  UserRound,
  History,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Clock3,
  Trash2,
  RefreshCw,
  MonitorUp,
} from "lucide-react";

import { useChat } from "@/hooks/use-chat";
import { useRoom } from "@/hooks/use-rooms";
import { useToast } from "@/hooks/use-toast";
import { ChatInput } from "@/components/chat/chat-input";
import { MessageBubble } from "@/components/chat/message-bubble";

type SavedRoom = {
  id: string;
  lastUsedAt: number;
  displayName?: string;
};

const SAVED_ROOMS_KEY = "axyntrel.savedRooms";

export default function Chat() {
  const [, params] = useRoute("/room/:id");
  const roomId = params?.id || "";
  const { data: room } = useRoom(roomId || null);

  const { toast } = useToast();

  const {
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
    upgradeCallToVideo,
    toggleScreenShare,
    switchCamera,
    clearCallLogs,
  } = useChat(roomId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [copied, setCopied] = useState(false);
  const [showCallLogs, setShowCallLogs] = useState(false);

  useEffect(() => {
    const id = roomId.trim().toUpperCase();
    if (!id) return;

    try {
      const raw = localStorage.getItem(SAVED_ROOMS_KEY);
      const parsed = raw ? (JSON.parse(raw) as SavedRoom[]) : [];
      const safe = Array.isArray(parsed) ? parsed : [];
      const existing = safe.find((room) => room && typeof room.id === "string" && room.id === id);

      const next = [
        {
          id,
          lastUsedAt: Date.now(),
          displayName: room?.creatorDisplayName ?? existing?.displayName,
        },
        ...safe.filter((room) => room && typeof room.id === "string" && room.id !== id),
      ].slice(0, 30);

      localStorage.setItem(SAVED_ROOMS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures in restricted browser contexts.
    }
  }, [roomId, room?.creatorDisplayName]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });


  /* AUTO SCROLL */

  useEffect(() => {

    if (scrollRef.current) {

      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth"
      });

    }

  }, [messages, peerIsTyping]);

  const localVideoTrackCount = callState.localStream?.getVideoTracks().length ?? 0;
  const remoteVideoTrackCount = callState.remoteStream?.getVideoTracks().length ?? 0;

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = callState.remoteStream;
      if (callState.remoteStream) {
        remoteVideoRef.current.play().catch(() => {
          // Autoplay may be blocked by browser policy; user interaction will resume playback.
        });
      }
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = callState.localStream;
      if (callState.localStream) {
        localVideoRef.current.play().catch(() => {
          // Ignore autoplay restrictions.
        });
      }
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = callState.remoteStream;
      if (callState.remoteStream) {
        remoteAudioRef.current.play().catch(() => {
          // Ignore autoplay restrictions.
        });
      }
    }
  }, [
    callState.callType,
    callState.localStream,
    callState.remoteStream,
    callState.isScreenSharing,
    localVideoTrackCount,
    remoteVideoTrackCount,
  ]);


  /* COPY ROOM ID */

  const copyRoomId = () => {

    navigator.clipboard.writeText(roomId);

    setCopied(true);

    toast({
      title: "Room ID copied",
      description: "Share this to establish a secure connection."
    });

    setTimeout(() => setCopied(false), 2000);

  };

  /* STATUS CONFIG */

  const statusConfig = {

    connecting: {
      color: "text-muted-foreground",
      text: "Connecting...",
      icon: Lock
    },

    generating_keys: {
      color: "text-yellow-300",
      text: "Generating Keys...",
      icon: Lock
    },

    waiting_for_peer: {
      color: "text-amber-300",
      text: "Awaiting Peer",
      icon: ShieldAlert
    },

    secured: {
      color: "text-primary",
      text: "E2EE Secured",
      icon: ShieldCheck
    },

    disconnected: {
      color: "text-destructive",
      text: "Disconnected",
      icon: ShieldAlert
    },

    error: {
      color: "text-destructive",
      text: "Connection Error",
      icon: ShieldAlert
    }

  };

  const currentStatus = statusConfig[connectionState] ?? statusConfig.connecting;
  const StatusIcon = currentStatus.icon;

  const callQualityConfig = {
    idle: {
      label: "Idle",
      className: "text-muted-foreground border-border/60 bg-card/60",
    },
    connecting: {
      label: "Connecting",
      className: "text-amber-300 border-amber-400/40 bg-amber-400/10",
    },
    good: {
      label: "Stable",
      className: "text-emerald-300 border-emerald-400/40 bg-emerald-400/10",
    },
    degraded: {
      label: "Degraded",
      className: "text-yellow-300 border-yellow-400/40 bg-yellow-400/10",
    },
    lost: {
      label: "Lost",
      className: "text-destructive border-destructive/40 bg-destructive/10",
    },
  } as const;

  const currentCallQuality = callQualityConfig[callState.connectionQuality] ?? callQualityConfig.idle;

  /* ERROR SCREEN */

  if (errorMsg) {

    return (

      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-4 bg-background">

        <ShieldAlert className="w-16 h-16 text-destructive mb-4" />

        <h2 className="text-xl font-mono font-bold mb-2">
          Connection Failed
        </h2>

        <p className="text-muted-foreground mb-6 text-center">
          {errorMsg}
        </p>

        <Link
          href="/"
          className="px-6 py-2 rounded-lg bg-primary text-primary-foreground font-medium"
        >
          Return Home
        </Link>

      </div>

    );

  }

  return (

    <div className="h-[100dvh] flex flex-col bg-background chat-atmosphere">

      {/* HEADER */}

      <header className="flex-none h-16 border-b border-border/70 lux-panel flex items-center justify-between px-3 sm:px-4 z-10 sticky top-0 backdrop-blur-md dark:bg-[#111b21]/95 dark:border-[#1f2c33]">

        <div className="flex items-center gap-3">

          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground p-2 rounded-lg hover:bg-secondary/70 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>

          <div className="flex flex-col">

            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={copyRoomId}
            >

              <h1 className="font-mono font-bold text-sm tracking-widest">
                ID: {roomId}
              </h1>

              {copied ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-muted-foreground" />
              )}

            </div>

            <div className={`flex items-center gap-1 text-xs ${currentStatus.color}`}>

              <StatusIcon className="w-3 h-3" />
              {currentStatus.text}

            </div>

          </div>

        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCallLogs((prev) => !prev)}
            className="p-2 rounded-lg border border-border/70 text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-all hover-elevate"
            aria-label="Toggle call logs"
          >
            <History className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => startCall("audio")}
            disabled={connectionState !== "secured" || callState.status !== "idle"}
            className="p-2 rounded-lg border border-border/70 text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-all hover-elevate disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Start voice call"
          >
            <Phone className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => startCall("video")}
            disabled={connectionState !== "secured" || callState.status !== "idle"}
            className="p-2 rounded-lg border border-border/70 text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-all hover-elevate disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Start video call"
          >
            <Video className="w-4 h-4" />
          </button>

        </div>

      </header>

      {showCallLogs && (
        <div className="px-4 pt-3">
          <div className="max-w-3xl mx-auto rounded-xl lux-panel lux-frame p-3 animate-reveal-up dark:bg-[#111b21] dark:border-[#1f2c33]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <History className="w-4 h-4" />
                Call Logs
              </h3>

              <button
                type="button"
                onClick={clearCallLogs}
                className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            </div>

            {callLogs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-card/50 px-3 py-3 text-center text-xs text-muted-foreground dark:bg-[#1a252d]">
                No call history yet. Your first secure call will appear here.
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {callLogs.slice(0, 12).map((log) => {
                  const icon =
                    log.direction === "incoming" ? (
                      log.outcome === "missed" ? (
                        <PhoneMissed className="w-3.5 h-3.5 text-destructive" />
                      ) : (
                        <PhoneIncoming className="w-3.5 h-3.5 text-primary" />
                      )
                    ) : (
                      <PhoneOutgoing className="w-3.5 h-3.5 text-muted-foreground" />
                    );

                  return (
                    <div
                      key={log.id}
                      className="rounded-lg border border-border/70 bg-card/70 px-2.5 py-2 flex items-center justify-between hover-elevate dark:bg-[#202c33] dark:border-[#2a3942]"
                    >
                      <div className="flex items-center gap-2">
                        {icon}
                        <div className="text-xs">
                          <div className="font-medium text-foreground capitalize">
                            {log.direction} {log.callType} call
                          </div>
                          <div className="text-muted-foreground capitalize">{log.outcome}</div>
                        </div>
                      </div>

                      <div className="text-[11px] text-muted-foreground text-right">
                        <div>{formatTime(log.startedAt)}</div>
                        <div className="inline-flex items-center gap-1">
                          <Clock3 className="w-3 h-3" />
                          {formatDuration(log.durationSec)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {callState.error && (
        <div className="px-4 pt-3">
          <div className="max-w-3xl mx-auto rounded-lg border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2 text-sm lux-frame">
            {callState.error}
          </div>
        </div>
      )}

      {/* CHAT AREA */}

      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 sm:p-4 relative"
      >

        <div className="max-w-3xl mx-auto flex flex-col min-h-full pb-4">

          {/* EMPTY STATE */}

          {messages.length === 0 && connectionState === "secured" && (

            <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground select-none px-4">

              <div className="w-16 h-16 mb-4 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center animate-float-soft">
                <ShieldCheck className="w-9 h-9 text-primary" />
              </div>

              <h2 className="font-semibold text-foreground mb-1">Secure channel is live</h2>

              <p className="font-mono text-sm max-w-xs text-muted-foreground">
                Connection secured with end-to-end encryption.
                Messages exist only on these devices.
              </p>

              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <span className="status-badge status-success">Encrypted transport</span>
                <span className="status-badge status-info">No server message storage</span>
              </div>

              <p className="mt-3 text-xs text-muted-foreground">Send a message below to begin the conversation.</p>

              <div className="mt-4 grid grid-cols-2 gap-2 w-full max-w-xs text-left">
                <div className="rounded-lg border border-border/70 bg-card/60 px-2 py-1.5 text-[10px]">
                  Press Enter to send
                </div>
                <div className="rounded-lg border border-border/70 bg-card/60 px-2 py-1.5 text-[10px]">
                  Shift+Enter for new line
                </div>
              </div>

            </div>

          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* TYPING INDICATOR */}

          {peerIsTyping && (

            <div className="text-muted-foreground text-sm mt-2 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/75 px-3 py-1.5 dark:bg-[#111b21]/80 dark:border-[#23323d]">
              <span className="text-xs">typing</span>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce [animation-delay:-0.2s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce [animation-delay:-0.1s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce" />
              </span>
            </div>

          )}

        </div>

      </main>

      {/* INPUT */}

      <div className="flex-none">

        <ChatInput
          onSendMessage={(text, timer) =>
            sendMessage({ text }, timer)
          }

          onSendImage={(image, timer) =>
            sendMessage({ image }, timer)
          }

          onSendFile={(file, timer) =>
            sendMessage({ file }, timer)
          }

          onAttachmentError={(message) =>
            toast({
              title: "Attachment failed",
              description: message,
              variant: "destructive",
            })
          }

          onTyping={sendTypingStatus}

          disabled={connectionState !== "secured"}
        />

      </div>

      {/* INCOMING CALL PROMPT */}
      {callState.isReceiving && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">

          <div className="w-full max-w-sm rounded-2xl lux-panel lux-frame p-6 text-center space-y-5">

            <div className="mx-auto w-14 h-14 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center animate-pulse-glow">
              {callState.callType === "video" ? (
                <Video className="w-6 h-6 text-primary" />
              ) : (
                <Phone className="w-6 h-6 text-primary" />
              )}
            </div>

            <div className="space-y-1">
              <h3 className="font-semibold text-lg">Incoming {callState.callType} call</h3>
              <p className="text-sm text-muted-foreground">Room {roomId}</p>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-mono tracking-wider uppercase text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Secure Session
              </div>
            </div>

            <div className="flex items-center gap-3 justify-center">
              <button
                type="button"
                onClick={rejectCall}
                className="h-11 px-4 rounded-lg bg-destructive text-destructive-foreground inline-flex items-center gap-2 shadow-[0_10px_24px_rgba(239,68,68,0.3)] hover:brightness-95 transition-all"
              >
                <PhoneOff className="w-4 h-4" />
                Decline
              </button>

              <button
                type="button"
                onClick={acceptCall}
                className="h-11 px-4 rounded-lg bg-primary text-primary-foreground inline-flex items-center gap-2 shadow-[0_10px_24px_hsl(var(--primary)/0.32)] hover:brightness-95 transition-all"
              >
                <Phone className="w-4 h-4" />
                Accept
              </button>
            </div>

          </div>

        </div>
      )}

      {/* ACTIVE/OUTGOING CALL OVERLAY */}
      {callState.status !== "idle" && !callState.isReceiving && (
        <div className="fixed inset-0 z-40 bg-gradient-to-b from-[#04070a]/95 via-[#0a1118]/95 to-[#04070a]/98 p-3 sm:p-4 flex flex-col">

          <div className="mx-auto w-full max-w-4xl mb-3 flex items-center justify-between text-xs text-muted-foreground px-1">
            <div className="capitalize inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-2.5 py-1 backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              {callState.callType} call • {callState.status === "outgoing" ? "Ringing" : callState.status}
            </div>
            <div className="flex items-center gap-2">
              <div className={`font-mono rounded-full border px-2.5 py-1 backdrop-blur-sm ${currentCallQuality.className}`}>
                {currentCallQuality.label}
              </div>
              <div className="font-mono rounded-full border border-border/60 bg-card/60 px-2.5 py-1 backdrop-blur-sm">
                {formatDuration(callState.durationSec)}
              </div>
            </div>
          </div>

          {callState.error && (
            <div className="mx-auto w-full max-w-4xl mb-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {callState.error}
            </div>
          )}

          <div className="mx-auto w-full max-w-4xl flex-1 relative rounded-2xl overflow-hidden lux-panel lux-frame">

            {callState.callType === "video" ? (
              <div className="w-full h-full bg-black relative">
                {callState.remoteStream?.getVideoTracks().length ? (
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    {callState.remoteStream ? "Peer audio connected. Waiting for video..." : "Waiting for peer video..."}
                  </div>
                )}

                {callState.localStream && (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="absolute bottom-3 right-3 w-32 h-24 sm:w-40 sm:h-28 rounded-lg border border-border/70 bg-black object-cover shadow-lg"
                  />
                )}
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-foreground gap-4 bg-gradient-to-br from-card to-background">
                <div className="w-20 h-20 rounded-full bg-primary/15 border border-primary/35 flex items-center justify-center">
                  <UserRound className="w-10 h-10 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {callState.remoteStream ? "Connected" : "Waiting for peer audio..."}
                </p>
                <audio ref={remoteAudioRef} autoPlay playsInline />
              </div>
            )}

          </div>

          <div className="h-20 mt-4 flex items-center justify-center gap-3 sm:gap-4 rounded-2xl border border-border/50 bg-card/50 backdrop-blur-md max-w-4xl mx-auto w-full">

            <button
              type="button"
              onClick={toggleMic}
              className="h-12 w-12 rounded-full bg-card/90 border border-border text-secondary-foreground flex items-center justify-center hover-elevate"
              aria-label="Toggle microphone"
            >
              {callState.micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            {callState.isInCall &&
              (!callState.localStream?.getVideoTracks().length || callState.callType === "audio") && (
              <button
                type="button"
                onClick={() => void upgradeCallToVideo()}
                className="h-12 px-4 rounded-full bg-card/90 border border-border text-secondary-foreground inline-flex items-center gap-2 hover-elevate"
                aria-label="Switch to video call"
              >
                <Video className="w-5 h-5" />
                Video
              </button>
            )}

            {callState.callType === "video" && (
              <>
                <button
                  type="button"
                  onClick={toggleCamera}
                  disabled={callState.isScreenSharing}
                  className="h-12 w-12 rounded-full bg-card/90 border border-border text-secondary-foreground flex items-center justify-center hover-elevate"
                  aria-label="Toggle camera"
                >
                  {callState.cameraOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </button>

                <button
                  type="button"
                  onClick={() => void toggleScreenShare()}
                  className="h-12 w-12 rounded-full bg-card/90 border border-border text-secondary-foreground flex items-center justify-center hover-elevate"
                  aria-label={callState.isScreenSharing ? "Stop screen share" : "Start screen share"}
                  title={callState.isScreenSharing ? "Stop screen share" : "Start screen share"}
                >
                  <MonitorUp className="w-5 h-5" />
                </button>

                <button
                  type="button"
                  onClick={() => void switchCamera()}
                  disabled={callState.isScreenSharing}
                  className="h-12 w-12 rounded-full bg-card/90 border border-border text-secondary-foreground flex items-center justify-center hover-elevate"
                  aria-label="Switch camera"
                  title={`Switch to ${callState.cameraFacing === "user" ? "back" : "front"} camera`}
                >
                  <RefreshCw className="w-5 h-5" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={endCall}
              className="h-12 px-5 rounded-full bg-destructive text-destructive-foreground inline-flex items-center gap-2 shadow-[0_12px_24px_rgba(239,68,68,0.35)] hover:brightness-95 transition-all"
            >
              <PhoneOff className="w-5 h-5" />
              End
            </button>

          </div>

        </div>
      )}

    </div>

  );

}
