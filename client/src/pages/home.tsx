import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Shield, Key, Terminal, ArrowRight, Loader2, History, Trash2, Search, Users, Shuffle, Bell, Check, X, Sparkles, Rocket, Fingerprint, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateRoom } from "@/hooks/use-rooms";
import { api, buildUrl } from "@shared/routes";
import { QRCodeCanvas } from "qrcode.react";
import { Scanner } from "@yudiel/react-qr-scanner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SavedRoom = {
  id: string;
  lastUsedAt: number;
};

type OnlineUser = {
  userId: string;
  displayName: string;
  lastSeenAt: number;
  isOnline: boolean;
};

type InviteItem = {
  roomId: string;
  fromUserId: string;
  fromDisplayName: string;
  createdAt: number;
};

const SAVED_ROOMS_KEY = "axyntrel.savedRooms";
const PROFILE_KEY = "axyntrel.profile";

export default function Home() {
  const [, setLocation] = useLocation();
  const createRoom = useCreateRoom();

  const [joinId, setJoinId] = useState("");
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isCreatingQr, setIsCreatingQr] = useState(false);
  const [qrRoomId, setQrRoomId] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [showSavedRooms, setShowSavedRooms] = useState(false);
  const [savedRoomsExpanded, setSavedRoomsExpanded] = useState(false);
  const [savedRooms, setSavedRooms] = useState<SavedRoom[]>([]);
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [isMatchmaking, setIsMatchmaking] = useState(false);
  const [copiedUserId, setCopiedUserId] = useState(false);
  const [copiedProfileLink, setCopiedProfileLink] = useState(false);
  const isFirstRun = savedRooms.length === 0;
  const qrSectionRef = useRef<HTMLDivElement | null>(null);

  const normalizeUserId = (value: string) =>
    value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 24);

  const profileReady = normalizeUserId(userId).length >= 3 && displayName.trim().length >= 2;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_ROOMS_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as SavedRoom[];
      if (!Array.isArray(parsed)) return;

      const sanitized = parsed
        .filter((room) => room && typeof room.id === "string" && typeof room.lastUsedAt === "number")
        .map((room) => ({
          id: room.id.trim().toUpperCase(),
          lastUsedAt: room.lastUsedAt,
        }))
        .slice(0, 30);

      setSavedRooms(sanitized);
    } catch {
      // Ignore invalid local cache.
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as { userId?: string; displayName?: string };
      if (parsed.userId) setUserId(normalizeUserId(parsed.userId));
      if (parsed.displayName) setDisplayName(parsed.displayName.slice(0, 32));
    } catch {
      // Ignore invalid profile cache.
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deepLinkUser = normalizeUserId(params.get("user") ?? "");
    if (!deepLinkUser) return;
    setSearchQuery(deepLinkUser);
  }, []);

  useEffect(() => {
    if (!profileReady) return;

    const payload = {
      userId: normalizeUserId(userId),
      displayName: displayName.trim().slice(0, 32),
    };

    localStorage.setItem(PROFILE_KEY, JSON.stringify(payload));

    const registerPresence = async () => {
      try {
        await fetch(api.presence.register.path, {
          method: api.presence.register.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        // Ignore transient network errors.
      }
    };

    registerPresence();
    const interval = window.setInterval(registerPresence, 10_000);
    return () => window.clearInterval(interval);
  }, [userId, displayName, profileReady]);

  useEffect(() => {
    if (!profileReady) {
      setOnlineUsers([]);
      return;
    }

    const loadOnlineUsers = async () => {
      try {
        const params = new URLSearchParams({ self: normalizeUserId(userId) });
        if (searchQuery.trim()) {
          params.set("q", searchQuery.trim());
        }

        const res = await fetch(`${api.presence.online.path}?${params.toString()}`);
        if (!res.ok) return;

        const parsed = api.presence.online.responses[200].parse(await res.json());
        setOnlineUsers(parsed);
      } catch {
        // Ignore polling failures.
      }
    };

    loadOnlineUsers();
    const interval = window.setInterval(loadOnlineUsers, 5_000);
    return () => window.clearInterval(interval);
  }, [userId, profileReady, searchQuery]);

  useEffect(() => {
    if (!profileReady) {
      setInvites([]);
      return;
    }

    const loadInvites = async () => {
      try {
        const url = buildUrl(api.presence.invites.list.path, {
          userId: normalizeUserId(userId),
        });

        const res = await fetch(url);
        if (!res.ok) return;

        const parsed = api.presence.invites.list.responses[200].parse(await res.json());
        setInvites(parsed);
      } catch {
        // Ignore polling failures.
      }
    };

    loadInvites();
    const interval = window.setInterval(loadInvites, 3_000);
    return () => window.clearInterval(interval);
  }, [userId, profileReady]);

  useEffect(() => {
    if (!qrRoomId || !qrSectionRef.current) return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;

    const timer = window.setTimeout(() => {
      qrSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }, 160);

    return () => window.clearTimeout(timer);
  }, [qrRoomId]);

  const persistSavedRooms = (rooms: SavedRoom[]) => {
    setSavedRooms(rooms);
    localStorage.setItem(SAVED_ROOMS_KEY, JSON.stringify(rooms));
  };

  const rememberRoom = (roomId: string) => {
    const id = roomId.trim().toUpperCase();
    if (!id) return;

    setSavedRooms((prev) => {
      const next = [
        { id, lastUsedAt: Date.now() },
        ...prev.filter((room) => room.id !== id),
      ].slice(0, 30);

      localStorage.setItem(SAVED_ROOMS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const ensureRoomExists = async (roomId: string) => {
    const id = roomId.trim().toUpperCase();
    if (!id) return false;

    try {
      const getUrl = buildUrl(api.rooms.get.path, { id });
      const getRes = await fetch(getUrl);

      if (getRes.ok) return true;

      if (getRes.status === 404) {
        const createRes = await fetch(api.rooms.create.path, {
          method: api.rooms.create.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });

        // If another client created it in parallel, uniqueness conflict may occur.
        // In that case we can still proceed to join the same room id.
        return createRes.ok || createRes.status === 409 || createRes.status === 400;
      }

      return false;
    } catch {
      return false;
    }
  };

  const openRoom = async (roomId: string) => {
    const id = roomId.trim().toUpperCase();
    if (!id) return;

    rememberRoom(id);
    await ensureRoomExists(id);
    setLocation(`/room/${id}`);
  };

  const removeSavedRoom = (roomId: string) => {
    const next = savedRooms.filter((room) => room.id !== roomId);
    persistSavedRooms(next);
  };

  const clearSavedRooms = () => {
    persistSavedRooms([]);
  };

  const openSavedRoom = (roomId: string) => {
    const id = roomId.trim().toUpperCase();
    if (!id) return;

    rememberRoom(id);
    setLocation(`/room/${id}`);
    void ensureRoomExists(id);
    setSavedRoomsExpanded(false);
  };

  const connectToUser = async (targetUserId: string) => {
    if (!profileReady) return;

    setIsMatchmaking(true);
    try {
      const res = await fetch(api.presence.connect.user.path, {
        method: api.presence.connect.user.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromUserId: normalizeUserId(userId),
          toUserId: targetUserId,
        }),
      });

      if (!res.ok) return;

      const parsed = api.presence.connect.user.responses[200].parse(await res.json());
      rememberRoom(parsed.roomId);
      setLocation(`/room/${parsed.roomId}`);
    } finally {
      setIsMatchmaking(false);
    }
  };

  const connectRandom = async () => {
    if (!profileReady || onlineUsers.length === 0) return;

    setIsMatchmaking(true);
    try {
      const res = await fetch(api.presence.connect.random.path, {
        method: api.presence.connect.random.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId: normalizeUserId(userId) }),
      });

      if (!res.ok) return;

      const parsed = api.presence.connect.random.responses[200].parse(await res.json());
      rememberRoom(parsed.roomId);
      setLocation(`/room/${parsed.roomId}`);
    } finally {
      setIsMatchmaking(false);
    }
  };

  const acceptInvite = async (roomId: string) => {
    const url = buildUrl(api.presence.invites.accept.path, {
      userId: normalizeUserId(userId),
      roomId,
    });

    const res = await fetch(url, { method: api.presence.invites.accept.method });
    if (!res.ok) return;

    rememberRoom(roomId);
    setLocation(`/room/${roomId}`);
  };

  const rejectInvite = async (roomId: string) => {
    const url = buildUrl(api.presence.invites.reject.path, {
      userId: normalizeUserId(userId),
      roomId,
    });

    const res = await fetch(url, { method: api.presence.invites.reject.method });
    if (!res.ok) return;

    setInvites((prev) => prev.filter((invite) => invite.roomId !== roomId));
  };

  const copyUserId = async () => {
    const id = normalizeUserId(userId);
    if (!id) return;

    try {
      await navigator.clipboard.writeText(id);
      setCopiedUserId(true);
      window.setTimeout(() => setCopiedUserId(false), 1400);
    } catch {
      setCopiedUserId(false);
    }
  };

  const shareProfileLink = async () => {
    const id = normalizeUserId(userId);
    if (!id) return;

    const link = `${window.location.origin}/?user=${encodeURIComponent(id)}`;

    try {
      await navigator.clipboard.writeText(link);
      setCopiedProfileLink(true);
      window.setTimeout(() => setCopiedProfileLink(false), 1600);
    } catch {
      setCopiedProfileLink(false);
    }
  };

  const formatLastUsed = (timestamp: number) =>
    new Date(timestamp).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const handleCreate = async () => {
    setIsCreatingRoom(true);
    try {
      const room = await createRoom.mutateAsync(undefined);
      rememberRoom(room.id);
      setLocation(`/room/${room.id}`);
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleCreateQr = async () => {
    setIsCreatingQr(true);
    try {
      const room = await createRoom.mutateAsync(undefined);
      rememberRoom(room.id);
      setQrRoomId(room.id);
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreatingQr(false);
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinId.trim()) {
      openRoom(joinId.trim());
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-start p-3 sm:p-4 md:p-8 pt-4 md:pt-6 relative overflow-hidden">

      {/* Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[560px] bg-primary/10 rounded-full blur-[130px] pointer-events-none" />

      <div className="w-full max-w-4xl z-10 flex flex-col gap-6 lg:gap-7">

        {/* Header */}
        <div className="text-center space-y-4 animate-reveal-up rounded-3xl border border-border/60 bg-gradient-to-b from-card/70 to-card/45 p-5 md:p-7 shadow-[0_16px_38px_rgba(0,0,0,0.16)]">

          <div className="w-full max-w-3xl mx-auto px-2 sm:px-4 space-y-4">
            <div className="inline-flex items-center gap-3 p-3 rounded-3xl lux-panel lux-frame mb-2">
              <div className="w-12 h-12 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center animate-float-soft">
                <Shield className="w-6 h-6 text-primary animate-pulse-glow" />
              </div>
              <div className="text-left">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Axyntrel Secure</div>
                <div className="font-mono text-sm font-semibold text-foreground">Private Communication Layer</div>
              </div>
            </div>

            <div className="space-y-3 relative">
              <div className="hero-title-spotlight" aria-hidden="true" />
              <h1 className="text-[2.15rem] sm:text-[3rem] md:text-[3.5rem] font-extrabold font-mono tracking-[-0.03em] leading-[0.98] text-transparent bg-clip-text bg-gradient-to-b from-foreground via-foreground to-foreground/75 drop-shadow-[0_8px_24px_rgba(0,0,0,0.22)]">
                Axyntrel
              </h1>

              <div className="mx-auto w-36 h-[3px] rounded-full hero-title-underline" aria-hidden="true" />

              <p className="text-muted-foreground/95 text-[1rem] md:text-[1.16rem] max-w-[36ch] mx-auto leading-[1.45] font-medium break-words">
                Peer-to-peer ephemeral chat. Zero knowledge.
                <br className="hidden sm:block" />
                True end-to-end encryption via Web Crypto API.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1 max-w-2xl mx-auto">
              <span className="text-[11px] px-3 py-1.5 rounded-full bg-card/82 border border-border/80 text-foreground/85 shadow-[0_6px_16px_rgba(0,0,0,0.15)]">Zero logs</span>
              <span className="text-[11px] px-3 py-1.5 rounded-full bg-card/82 border border-border/80 text-foreground/85 shadow-[0_6px_16px_rgba(0,0,0,0.15)]">P2P first</span>
              <span className="text-[11px] px-3 py-1.5 rounded-full bg-card/82 border border-border/80 text-foreground/85 shadow-[0_6px_16px_rgba(0,0,0,0.15)]">Built for teams</span>
            </div>

            {/* Encryption Indicator */}
            <div className="flex flex-wrap justify-center gap-2 max-w-2xl mx-auto">
              <div className="flex items-center gap-2 text-xs font-mono text-primary bg-primary/12 px-3 py-1 rounded-full border border-primary/25">
                <span className="w-2 h-2 bg-yellow-300 rounded-full animate-pulse"></span>
                End-to-End Encryption Active
              </div>
            </div>
          </div>

        </div>

        {/* Main Card */}
        <div className="lux-panel lux-frame rounded-3xl p-5 md:p-7 space-y-6 animate-reveal-up">
          <div className="rounded-2xl border border-border/60 bg-gradient-to-b from-card/70 to-card/45 p-4 md:p-5 space-y-3 shadow-[0_14px_36px_rgba(0,0,0,0.16)]">
            <div className="flex items-center justify-between rounded-xl border border-border/60 bg-background/55 px-3 py-2">
              <h2 className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground font-mono inline-flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-primary/12 border border-primary/25">
                  <Users className="w-3.5 h-3.5 text-primary" />
                </span>
                Connect in App
              </h2>
              {invites.length > 0 && (
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-primary/15 text-primary border border-primary/30 inline-flex items-center gap-1 font-medium">
                  <Bell className="w-3 h-3" />
                  {invites.length}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Input
                id="user-id"
                name="userId"
                value={userId}
                onChange={(e) => setUserId(normalizeUserId(e.target.value))}
                placeholder="YOUR ID (e.g. AXY_007)"
                  className="h-11 font-mono tracking-wider bg-card/85 border-border/80"
              />
              <Input
                id="display-name"
                name="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value.slice(0, 32))}
                placeholder="Display name"
                  className="h-11 bg-card/85 border-border/80"
              />
            </div>

            {profileReady && (
              <div className="flex items-center justify-between rounded-xl border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.12)] px-3 py-2">
                  <div className="text-[11px] text-[hsl(var(--success-foreground))]">
                  Online as <span className="font-mono tracking-wider">{normalizeUserId(userId)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={shareProfileLink}
                      className="text-[11px] px-2 py-1 rounded-md border border-[hsl(var(--success)/0.35)] hover:bg-[hsl(var(--success)/0.14)] text-[hsl(var(--success-foreground))]"
                  >
                    {copiedProfileLink ? "Link Copied" : "Share Link"}
                  </button>
                  <button
                    type="button"
                    onClick={copyUserId}
                      className="text-[11px] px-2 py-1 rounded-md border border-[hsl(var(--success)/0.35)] hover:bg-[hsl(var(--success)/0.14)] text-[hsl(var(--success-foreground))]"
                  >
                    {copiedUserId ? "Copied" : "Copy ID"}
                  </button>
                </div>
              </div>
            )}

            {!profileReady && (
              <p className="text-[11px] text-muted-foreground">
                Set a user ID (min 3 chars) and display name (min 2 chars) to appear online.
              </p>
            )}

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="search-user"
                  name="searchUser"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search user ID"
                  className="h-11 pl-9 bg-card/85 border-border/80"
                  disabled={!profileReady}
                />
              </div>

              <Button
                type="button"
                variant="outline"
                className="h-11 px-5 bg-card/85 border-border/80 hover:bg-card text-foreground"
                onClick={connectRandom}
                disabled={!profileReady || isMatchmaking || onlineUsers.length === 0}
              >
                {isMatchmaking ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Shuffle className="w-4 h-4 mr-2" />
                    Random
                  </>
                )}
              </Button>
            </div>

            {invites.length > 0 && (
              <div className="space-y-2">
                {invites.slice(0, 3).map((invite) => (
                  <div
                    key={`${invite.roomId}:${invite.fromUserId}`}
                    className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5"
                  >
                    <div className="text-xs text-foreground">
                      <span className="font-mono">{invite.fromUserId}</span> invited you to room <span className="font-mono">{invite.roomId}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{invite.fromDisplayName}</div>

                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7"
                        onClick={() => acceptInvite(invite.roomId)}
                      >
                        <Check className="w-3.5 h-3.5 mr-1" />
                        Accept
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => rejectInvite(invite.roomId)}
                      >
                        <X className="w-3.5 h-3.5 mr-1" />
                        Decline
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
              {profileReady && onlineUsers.length === 0 ? (
                <div className="text-[11px] text-muted-foreground rounded-xl border border-border/50 bg-background/50 px-3 py-2">
                  No online users found.
                </div>
              ) : (
                onlineUsers.slice(0, 8).map((user) => (
                  <div
                    key={user.userId}
                    className="rounded-xl border border-border/60 bg-card/70 px-3 py-2 flex items-center justify-between gap-2 hover-elevate"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-mono truncate">{user.userId}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{user.displayName}</div>
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => connectToUser(user.userId)}
                      disabled={isMatchmaking}
                    >
                      Connect
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-4">

            {/* Create Room */}
            <Button
              onClick={handleCreate}
              disabled={isCreatingRoom || isCreatingQr}
              className="w-full h-15 text-[1.05rem] font-mono font-semibold rounded-2xl bg-gradient-to-r from-primary via-primary to-[hsl(var(--primary)/0.9)] text-primary-foreground shadow-[0_16px_34px_hsl(var(--primary)/0.34)] hover:brightness-95"
            >
              {isCreatingRoom ? (
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
              ) : (
                <Key className="w-5 h-5 mr-2" />
              )}
              Initialize Secure Room
            </Button>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border/70" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background/90 px-3 py-0.5 text-muted-foreground font-mono rounded-full border border-border/70 tracking-wider">
                  or
                </span>
              </div>
            </div>

            {/* Join Room */}
            <form onSubmit={handleJoin} className="flex gap-2">
              <div className="relative flex-1">
                <Terminal className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="join-room-id"
                  name="joinRoomId"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value.toUpperCase())}
                  placeholder="ENTER ROOM ID"
                  className="pl-9 h-13 font-mono text-center tracking-widest rounded-2xl bg-card/85 border-border/80"
                />
              </div>

              <Button
                type="submit"
                disabled={!joinId.trim()}
                size="icon"
                className="h-13 w-13 rounded-2xl bg-primary text-primary-foreground shadow-[0_12px_26px_hsl(var(--primary)/0.28)]"
              >
                <ArrowRight className="w-5 h-5" />
              </Button>
            </form>

            {/* Generate QR Room */}
            <Button
              variant="outline"
              className="w-full h-12 rounded-xl bg-card/85 border-border/80 hover:bg-card text-foreground"
              onClick={handleCreateQr}
              disabled={isCreatingRoom || isCreatingQr}
            >
              {isCreatingQr ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating QR...
                </>
              ) : (
                "Create QR Room"
              )}
            </Button>

            {/* Scan QR */}
            <Button
              variant="outline"
              className="w-full h-12 rounded-xl bg-card/85 border-border/80 hover:bg-card text-foreground"
              onClick={() => setShowScanner(true)}
            >
              Scan QR Code
            </Button>

            {qrRoomId && (
                <div ref={qrSectionRef} className="overflow-hidden">
                  <div className="mt-2 p-4 md:p-5 lux-panel lux-frame rounded-2xl text-center space-y-4">
                    <h2 className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      Scan To Join Secure Room
                    </h2>

                    <div className="flex justify-center">
                      <div className="bg-white p-3 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.28)]">
                        <QRCodeCanvas
                          value={`${window.location.origin}/room/${qrRoomId}`}
                          size={170}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-muted p-2 rounded-lg font-mono text-sm tracking-widest">
                      <span className="truncate pr-2">{qrRoomId}</span>

                      <button
                        onClick={() => navigator.clipboard.writeText(qrRoomId)}
                        className="text-xs text-primary shrink-0"
                      >
                        Copy
                      </button>
                    </div>

                    <Button
                      onClick={() => setLocation(`/room/${qrRoomId}`)}
                      className="w-full"
                    >
                      Enter Room
                    </Button>

                    <Button
                      variant="ghost"
                      className="w-full text-muted-foreground"
                      onClick={() => setQrRoomId(null)}
                    >
                      Close
                    </Button>
                  </div>
                </div>
            )}
          </div>

          {/* Security Info */}
          <div className="pt-4 border-t border-border/40">
            <ul className="text-[11px] font-mono text-muted-foreground/80 space-y-2">
              <li className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-primary/60" />
                Keys generated locally (ECDH P-256)
              </li>

              <li className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-primary/60" />
                No messages stored on servers
              </li>

              <li className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-primary/60" />
                AES-GCM encrypted transport
              </li>
            </ul>
          </div>

        </div>

        {isFirstRun && (
          <div className="rounded-3xl border border-border/60 bg-background/50 p-5 md:p-6 space-y-4 mt-2 w-full animate-reveal-up">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold">Getting Started</h2>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <div className="rounded-2xl border border-border/70 bg-card/75 p-4 space-y-2 hover-elevate">
                <div className="w-8 h-8 rounded-lg bg-primary/12 border border-primary/25 flex items-center justify-center">
                  <Fingerprint className="w-4 h-4 text-primary" />
                </div>
                <h3 className="font-medium text-sm">Create your identity</h3>
                <p className="text-xs text-muted-foreground">Set your user ID and name once so teammates can discover and connect instantly.</p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-card/75 p-4 space-y-2 hover-elevate">
                <div className="w-8 h-8 rounded-lg bg-primary/12 border border-primary/25 flex items-center justify-center">
                  <Users className="w-4 h-4 text-primary" />
                </div>
                <h3 className="font-medium text-sm">Invite with one tap</h3>
                <p className="text-xs text-muted-foreground">Share your profile link or room code to start a secure conversation in seconds.</p>
              </div>

              <div className="rounded-2xl border border-border/70 bg-card/75 p-4 space-y-2 hover-elevate">
                <div className="w-8 h-8 rounded-lg bg-primary/12 border border-primary/25 flex items-center justify-center">
                  <Rocket className="w-4 h-4 text-primary" />
                </div>
                <h3 className="font-medium text-sm">Launch your first room</h3>
                <p className="text-xs text-muted-foreground">Use Initialize Secure Room for a fresh encrypted session with no message retention.</p>
              </div>
            </div>
          </div>
        )}

          <div className="rounded-3xl border border-border/60 bg-gradient-to-b from-card/65 to-card/35 p-4 md:p-5 space-y-3 mt-2 w-full shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground font-mono inline-flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-primary/12 border border-primary/25">
                  <History className="w-3.5 h-3.5 text-primary" />
                </span>
                Saved Rooms
              </h2>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={clearSavedRooms}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-border/70 bg-card/70 text-muted-foreground hover:text-destructive hover:bg-destructive/10 inline-flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={savedRooms.length === 0}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear All
                </button>

                <button
                  type="button"
                  onClick={() => setSavedRoomsExpanded((prev) => !prev)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={savedRooms.length === 0}
                >
                  {savedRoomsExpanded ? "Hide list" : "Show list"}
                </button>
              </div>
            </div>

            {savedRooms.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-background/50 px-4 py-5 text-center text-sm text-muted-foreground">
                No saved rooms yet. Create or join a room to see it here.
              </div>
            ) : savedRoomsExpanded ? (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {savedRooms.map((room) => (
                  <div
                    key={room.id}
                    className="w-full rounded-2xl border border-border/60 bg-card/80 px-3 py-2.5 flex items-center justify-between gap-2 text-left hover:border-primary/40 hover:bg-primary/8"
                  >
                    <button
                      type="button"
                      onClick={() => openSavedRoom(room.id)}
                      className="min-w-0 text-left flex-1"
                    >
                      <div className="text-sm font-mono tracking-[0.12em] truncate text-foreground">{room.id}</div>
                      <div className="text-[11px] text-muted-foreground/90">
                        Last used {formatLastUsed(room.lastUsedAt)}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => openSavedRoom(room.id)}
                      className="text-[11px] px-2.5 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary shrink-0 hover:bg-primary/15 transition-colors"
                    >
                      Reopen
                    </button>

                    <button
                      type="button"
                      onClick={() => removeSavedRoom(room.id)}
                      className="shrink-0 p-1.5 rounded-full border border-transparent hover:border-destructive/30 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      aria-label={`Remove ${room.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-border/60 bg-background/50 px-4 py-4 text-center text-xs text-muted-foreground">
                Saved rooms available. Tap Show list to view and manage them.
              </div>
            )}
          </div>

        {/* Scanner Modal */}
        {showScanner && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">

            <div className="lux-panel lux-frame p-6 rounded-3xl space-y-4 w-full max-w-sm shadow-[0_24px_56px_rgba(0,0,0,0.35)]">

              <div className="flex items-center justify-center">
                <h2 className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground font-mono inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-primary/12 border border-primary/25">
                    <ScanLine className="w-3 h-3 text-primary" />
                  </span>
                  Scan Room QR
                </h2>
              </div>

              <p className="text-center text-xs text-muted-foreground -mt-1">
                Point your camera at a room QR to join instantly.
              </p>

              <div className="rounded-2xl border border-border/70 bg-background/50 p-2.5">
                <Scanner
                  onScan={(result) => {
                    if (result?.[0]?.rawValue) {
                      const url = new URL(result[0].rawValue);
                      const id = url.pathname.split("/room/")[1];
                      setShowScanner(false);
                      if (id) {
                        openRoom(id);
                      }
                    }
                  }}
                  onError={(err) => console.log(err)}
                />
              </div>

              <Button
                variant="outline"
                className="w-full h-11 rounded-xl border-border/80 bg-card/80 hover:bg-card text-foreground"
                onClick={() => setShowScanner(false)}
              >
                Close
              </Button>

            </div>
          </div>
        )}

      </div>

      {showSavedRooms && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg lux-panel lux-frame rounded-3xl p-6 space-y-4 shadow-[0_24px_56px_rgba(0,0,0,0.35)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground font-mono inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-primary/12 border border-primary/25">
                    <History className="w-3 h-3 text-primary" />
                  </span>
                  Saved Rooms
                </h2>
                <p className="text-sm text-muted-foreground mt-2">
                  Re-open previously used rooms. Messages are still not saved.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSavedRooms(false)}
                className="text-xs px-2.5 py-1 rounded-full border border-border/70 bg-card/70 text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
              >
                Close
              </button>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={clearSavedRooms}
                className="text-xs px-2.5 py-1 rounded-full border border-border/70 bg-card/70 text-muted-foreground hover:text-destructive hover:bg-destructive/10 inline-flex items-center gap-1 transition-colors"
                disabled={savedRooms.length === 0}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear All
              </button>
            </div>

            {savedRooms.length === 0 ? (
              <div className="rounded-xl border border-border/60 bg-background/50 px-4 py-6 text-center text-sm text-muted-foreground">
                No saved rooms yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {savedRooms.map((room) => (
                  <div
                    key={room.id}
                    className="rounded-2xl border border-border/60 bg-background/55 px-3.5 py-3 flex items-center justify-between gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => openSavedRoom(room.id)}
                      className="min-w-0 text-left"
                    >
                      <div className="text-sm font-mono tracking-[0.12em] text-foreground truncate">{room.id}</div>
                      <div className="text-[11px] text-muted-foreground">Last used {formatLastUsed(room.lastUsedAt)}</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => openSavedRoom(room.id)}
                      className="shrink-0 text-xs px-2.5 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
                    >
                      Reopen
                    </button>

                    <button
                      type="button"
                      onClick={() => removeSavedRoom(room.id)}
                      className="shrink-0 p-1.5 rounded-full border border-transparent hover:border-destructive/30 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      aria-label={`Remove ${room.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}