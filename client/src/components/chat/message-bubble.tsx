import { useState, useEffect } from "react";
import { Flame, Clock, FileText, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/hooks/use-chat";

type MessageBubbleProps = {
  message: ChatMessage;
  groupedWithPrev?: boolean;
};

export function MessageBubble({ message, groupedWithPrev = false }: MessageBubbleProps) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!message.expiresAt) return;

    const calculateTimeLeft = () => {
      const remaining = Math.max(0, message.expiresAt! - Date.now());
      setTimeLeft(Math.ceil(remaining / 1000));
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);
    
    return () => clearInterval(interval);
  }, [message.expiresAt]);

  const isUrgent = timeLeft !== null && timeLeft <= 5;
  const timeLabel = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const fileSizeLabel =
    message.file && message.file.size >= 1024
      ? `${(message.file.size / 1024).toFixed(1)} KB`
      : message.file
      ? `${message.file.size} B`
      : "";

  return (
    <div
      className={cn(
        "flex w-full",
        groupedWithPrev ? "mt-1" : "mt-2.5",
        message.isMine ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "relative max-w-[84%] md:max-w-[72%] px-3.5 py-2.5 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap break-words shadow-sm border",
          message.isMine
            ? "bg-[#d9fdd3] text-[#111b21] rounded-br-md border-[#c6e9c0] shadow-[0_2px_8px_rgba(0,0,0,0.08)] dark:bg-[#005c4b] dark:text-[#e9fff8] dark:border-[#0f8a70]/70 dark:shadow-[0_6px_14px_rgba(0,0,0,0.28)]"
            : "bg-white text-[#111b21] rounded-bl-md border-[#e5e7eb] shadow-[0_2px_8px_rgba(0,0,0,0.06)] dark:bg-[#111b21] dark:text-[#e9edef] dark:border-[#23323d]",
          groupedWithPrev && message.isMine && "rounded-tr-md",
          groupedWithPrev && !message.isMine && "rounded-tl-md"
        )}
      >
        {message.image && (
          <img 
            src={message.image} 
            alt="Sent image" 
            className="rounded-md mb-2 max-w-full h-auto cursor-pointer hover:opacity-95 transition-opacity" 
            onClick={() => window.open(message.image, '_blank')}
          />
        )}
        {message.file && (
          <a
            href={message.file.dataUrl}
            download={message.file.name}
            target="_blank"
            rel="noreferrer"
            className="mb-2 flex items-center justify-between gap-3 rounded-md border border-border/70 bg-background/55 px-3 py-2 hover:bg-background/70 transition-colors"
          >
            <div className="min-w-0 flex items-center gap-2">
              <FileText className="w-4 h-4 shrink-0" />
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{message.file.name}</div>
                <div className="text-[10px] opacity-70">{fileSizeLabel}</div>
              </div>
            </div>
            <Download className="w-4 h-4 shrink-0 opacity-80" />
          </a>
        )}
        {message.text && <div>{message.text}</div>}

        <div
          className={cn(
            "mt-1 text-[10px] font-mono opacity-70 text-right pr-0.5",
            message.isMine ? "text-primary-foreground/80 dark:text-[#d2f9ef]/80" : "text-muted-foreground dark:text-[#8696a0]"
          )}
        >
          {timeLabel}
        </div>
        
        {message.expiresAt && (
          <div 
            className={cn(
              "absolute -bottom-6 px-1.5 py-0.5 rounded-full border border-border/60 bg-background/70 backdrop-blur-sm flex items-center gap-1 text-[10px] font-mono font-medium dark:bg-[#0b141a]/90 dark:border-[#23323d]",
              message.isMine ? "right-1 text-muted-foreground dark:text-[#93a7b3]" : "left-1 text-muted-foreground dark:text-[#93a7b3]",
              isUrgent && "text-destructive border-destructive/50 animate-pulse"
            )}
          >
            {isUrgent ? <Flame className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
            {timeLeft}s
          </div>
        )}
      </div>
    </div>
  );
}
