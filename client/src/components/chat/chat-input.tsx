import { useEffect, useRef, useState } from "react";
import { Flame, Image as ImageIcon, Mic, Paperclip, Send, Square, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSendMessage: (text: string, destructTimer: number | null) => void;
  onSendImage: (image: string, destructTimer: number | null) => void;
  onSendFile: (
    file: { name: string; mimeType: string; size: number; dataUrl: string },
    destructTimer: number | null
  ) => void;
  onAttachmentError?: (message: string) => void;
  onTyping: (isTyping: boolean) => void;
  disabled?: boolean;
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_OUTPUT_QUALITY = 0.82;
const IMAGE_DIRECT_SEND_BYTES = 1.5 * 1024 * 1024;
const MAX_VOICE_NOTE_MS = 60_000;

const TIMER_OPTIONS = [
  { label: "Off", value: null },
  { label: "10s", value: 10 },
  { label: "30s", value: 30 },
  { label: "1m", value: 60 },
  { label: "5m", value: 300 },
];

export function ChatInput({
  onSendMessage,
  onSendImage,
  onSendFile,
  onAttachmentError,
  onTyping,
  disabled,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [timer, setTimer] = useState<number | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const recordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
  }, [text]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      if (recordTimeoutRef.current) {
        clearTimeout(recordTimeoutRef.current);
      }

      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const getSupportedVoiceMimeType = () => {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];

    if (typeof MediaRecorder === "undefined") {
      return "";
    }

    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
  };

  const optimizeImageFile = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const originalReader = new FileReader();

      originalReader.onerror = () => reject(new Error("Failed to read image."));
      originalReader.onload = () => {
        const originalDataUrl = originalReader.result as string;

        if (file.size <= IMAGE_DIRECT_SEND_BYTES) {
          resolve(originalDataUrl);
          return;
        }

        const img = new Image();
        img.onerror = () => reject(new Error("Failed to load image."));
        img.onload = () => {
          const maxSide = Math.max(img.width, img.height);
          const scale = maxSide > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / maxSide : 1;
          const targetWidth = Math.max(1, Math.round(img.width * scale));
          const targetHeight = Math.max(1, Math.round(img.height * scale));

          const canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = targetHeight;

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(originalDataUrl);
            return;
          }

          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

          const preferredType =
            file.type === "image/png" && file.size <= 3 * 1024 * 1024
              ? "image/png"
              : "image/jpeg";

          const optimizedDataUrl = canvas.toDataURL(preferredType, IMAGE_OUTPUT_QUALITY);
          resolve(optimizedDataUrl);
        };

        img.src = originalDataUrl;
      };

      originalReader.readAsDataURL(file);
    });

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    onTyping(true);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => onTyping(false), 1500);
  };

  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSendMessage(text.trim(), timer);
    setText("");
    onTyping(false);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || disabled) {
      return;
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      onAttachmentError?.("Attachment is too large. Max size is 25 MB.");
      e.target.value = "";
      return;
    }

    if (file.type.startsWith("image/")) {
      try {
        const optimizedDataUrl = await optimizeImageFile(file);
        onSendImage(optimizedDataUrl, timer);
      } catch {
        onAttachmentError?.("This image could not be processed.");
      }
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      onSendFile(
        {
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          dataUrl,
        },
        timer
      );
      e.target.value = "";
    };

    reader.readAsDataURL(file);
  };

  const stopVoiceRecording = () => {
    if (recordTimeoutRef.current) {
      clearTimeout(recordTimeoutRef.current);
      recordTimeoutRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const startVoiceRecording = async () => {
    if (disabled || isRecordingVoice) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onAttachmentError?.("Voice notes are not supported on this device/browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedVoiceMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      voiceChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        onAttachmentError?.("Voice note recording failed.");
        setIsRecordingVoice(false);
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        mediaRecorderRef.current = null;
      };

      recorder.onstop = () => {
        const blob = new Blob(voiceChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecordingVoice(false);

        if (blob.size === 0) {
          return;
        }

        if (blob.size > MAX_ATTACHMENT_BYTES) {
          onAttachmentError?.("Voice note is too large. Please record a shorter note.");
          return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
          onSendFile(
            {
              name: `voice-note-${Date.now()}.webm`,
              mimeType: blob.type || "audio/webm",
              size: blob.size,
              dataUrl: reader.result as string,
            },
            timer
          );
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      setIsRecordingVoice(true);
      recordTimeoutRef.current = setTimeout(() => stopVoiceRecording(), MAX_VOICE_NOTE_MS);
    } catch {
      onAttachmentError?.("Microphone permission is required to record a voice note.");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-input-container">
      <div className="max-w-3xl mx-auto relative rounded-[1.4rem] p-2.5 sm:p-2 frost-panel shine-border focus-within:ring-2 focus-within:ring-primary/35 transition-all duration-300 dark:bg-[#0b141a]/95 dark:border-[#1f2c33]">
        <input
          id="chat-image-upload"
          name="chatImageUpload"
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="*/*"
          onChange={handleAttachmentUpload}
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-1.5">
          <div className="flex items-end gap-2 sm:flex-1 sm:gap-1.5">
            <div className="flex-1 rounded-2xl border border-border/60 bg-background/55 px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] dark:bg-[#111b21] dark:border-[#23323d]">
              <textarea
                id="chat-message"
                name="chatMessage"
                ref={textareaRef}
                value={text}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="Write something encrypted..."
                disabled={disabled}
                className="w-full max-h-[120px] min-h-[42px] bg-transparent border-0 focus:ring-0 resize-none py-2 px-0 text-[14px] sm:text-[15px] leading-5 placeholder:text-muted-foreground/60 font-sans disabled:opacity-50 scrollbar-hidden outline-none dark:text-[#e9edef] dark:placeholder:text-[#8696a0]"
                rows={1}
              />
            </div>

            <Button
              onClick={handleSend}
              disabled={!text.trim() || disabled}
              size="icon"
              className="shrink-0 h-11 w-11 sm:h-9 sm:w-9 rounded-2xl sm:rounded-full bg-primary text-primary-foreground shadow-[0_10px_22px_hsl(var(--primary)/0.34)] hover:scale-[1.04] hover:brightness-95 transition-transform duration-200"
            >
              <Send className="w-4 h-4 ml-0.5" />
            </Button>
          </div>

          <div className="flex items-center justify-between gap-1 rounded-2xl border border-border/60 bg-background/35 px-1.5 py-1.5 sm:border-0 sm:bg-transparent sm:p-0 dark:bg-[#0f171d]/80 sm:dark:bg-transparent dark:border-[#1d2b34]">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-xl h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-secondary/80 hover-elevate dark:text-[#8696a0] dark:hover:text-[#d1dde5] dark:hover:bg-[#2a3942]"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              title="Share image"
            >
              <ImageIcon className="w-4.5 h-4.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-xl h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-secondary/80 hover-elevate dark:text-[#8696a0] dark:hover:text-[#d1dde5] dark:hover:bg-[#2a3942]"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              title="Share file"
            >
              <Paperclip className="w-4.5 h-4.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "shrink-0 rounded-xl h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-secondary/80 hover-elevate dark:text-[#8696a0] dark:hover:text-[#d1dde5] dark:hover:bg-[#2a3942]",
                isRecordingVoice && "text-destructive hover:text-destructive bg-destructive/15"
              )}
              disabled={disabled}
              onClick={isRecordingVoice ? stopVoiceRecording : startVoiceRecording}
              title={isRecordingVoice ? "Stop recording" : "Record voice note"}
            >
              {isRecordingVoice ? <Square className="w-4.5 h-4.5" /> : <Mic className="w-4.5 h-4.5" />}
            </Button>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "shrink-0 rounded-xl h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-secondary/80 hover-elevate dark:text-[#8696a0] dark:hover:text-[#d1dde5] dark:hover:bg-[#2a3942]",
                    timer !== null && "text-destructive hover:text-destructive bg-destructive/15"
                  )}
                  disabled={disabled}
                  title="Self-destruct timer"
                >
                  <Timer className="w-4.5 h-4.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-2" align="start" side="top">
                <div className="space-y-1">
                  <h4 className="text-xs font-mono font-bold text-muted-foreground px-2 py-1 uppercase tracking-wider">
                    Burn After Read
                  </h4>
                  {TIMER_OPTIONS.map((opt) => (
                    <Button
                      key={opt.label}
                      variant={timer === opt.value ? "secondary" : "ghost"}
                      className="w-full justify-start text-sm"
                      onClick={() => setTimer(opt.value)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      {timer && (
        <div className="max-w-3xl mx-auto mt-2 flex justify-center">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-destructive/15 border border-destructive/40 text-destructive text-[10px] font-mono font-bold tracking-widest uppercase animate-pulse">
            <Flame className="w-3 h-3" />
            Messages destroy in {TIMER_OPTIONS.find((option) => option.value === timer)?.label}
          </span>
        </div>
      )}
      {isRecordingVoice && (
        <div className="max-w-3xl mx-auto mt-2 flex justify-center">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-destructive/15 border border-destructive/40 text-destructive text-[10px] font-mono font-bold tracking-widest uppercase animate-pulse">
            <Mic className="w-3 h-3" />
            Recording voice note
          </span>
        </div>
      )}
    </div>
  );
}
