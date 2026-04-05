import { useState, useRef, useEffect } from "react";
import { Send, Timer, X, Image as ImageIcon, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSendMessage: (text: string, destructTimer: number | null) => void;
  onSendImage: (image: string, destructTimer: number | null) => void;
  onTyping: (isTyping: boolean) => void;
  disabled?: boolean;
}

const TIMER_OPTIONS = [
  { label: "Off", value: null },
  { label: "10s", value: 10 },
  { label: "30s", value: 30 },
  { label: "1m", value: 60 },
  { label: "5m", value: 300 },
];

export function ChatInput({ onSendMessage, onSendImage, onTyping, disabled }: ChatInputProps) {
  const [text, setText] = useState("");
  const [timer, setTimer] = useState<number | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [text]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    
    onTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => onTyping(false), 1500);
  };

  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSendMessage(text.trim(), timer);
    setText("");
    onTyping(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && !disabled) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        onSendImage(base64String, timer);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-4 bg-background/75 backdrop-blur-md border-t border-border/70 dark:bg-[#0b141a]/95 dark:border-[#1f2c33]">
      <div className="max-w-3xl mx-auto relative flex items-end gap-1.5 rounded-[1.05rem] p-2 frost-panel shine-border focus-within:ring-2 focus-within:ring-primary/35 transition-all duration-300 dark:bg-[#202c33] dark:border-[#2a3942] dark:shadow-none">
        
        <input 
          id="chat-image-upload"
          name="chatImageUpload"
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept="image/*" 
          onChange={handleImageUpload} 
        />
        
        <Button 
          variant="ghost" 
          size="icon" 
          className="shrink-0 rounded-lg h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-secondary/80 hover-elevate dark:text-[#8696a0] dark:hover:text-[#d1dde5] dark:hover:bg-[#2a3942]"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImageIcon className="w-5 h-5" />
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className={cn(
                "shrink-0 rounded-lg h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-secondary/80 hover-elevate dark:text-[#8696a0] dark:hover:text-[#d1dde5] dark:hover:bg-[#2a3942]",
                timer !== null && "text-destructive hover:text-destructive bg-destructive/15"
              )}
              disabled={disabled}
              title="Self-destruct timer"
            >
              <Timer className="w-5 h-5" />
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

        <textarea
          id="chat-message"
          name="chatMessage"
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type an encrypted message..."
          disabled={disabled}
          className="flex-1 max-h-[120px] min-h-[38px] bg-transparent border-0 focus:ring-0 resize-none py-2 px-1.5 text-[14px] placeholder:text-muted-foreground/60 font-sans disabled:opacity-50 scrollbar-hidden outline-none dark:text-[#e9edef] dark:placeholder:text-[#8696a0]"
          rows={1}
        />

        <Button 
          onClick={handleSend} 
          disabled={!text.trim() || disabled}
          size="icon"
          className="shrink-0 h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-[0_8px_16px_hsl(var(--primary)/0.3)] hover:scale-[1.04] hover:brightness-95 transition-transform duration-200"
        >
          <Send className="w-4 h-4 ml-0.5" />
        </Button>

      </div>
      
      {timer && (
        <div className="max-w-3xl mx-auto mt-2 flex justify-center">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-destructive/15 border border-destructive/40 text-destructive text-[10px] font-mono font-bold tracking-widest uppercase animate-pulse">
            <Flame className="w-3 h-3" />
            Messages destroy in {TIMER_OPTIONS.find(t => t.value === timer)?.label}
          </span>
        </div>
      )}
    </div>
  );
}
