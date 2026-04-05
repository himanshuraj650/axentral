import { useEffect, useState } from "react";
import { Monitor, Moon, Settings2, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [location] = useLocation();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  if (location.startsWith("/room/")) {
    return null;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <div className="fixed top-4 right-4 z-[70]">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-10 w-10 rounded-full border-border/80 bg-card/85 backdrop-blur-md shadow-[0_8px_22px_rgba(15,23,42,0.14)]"
            aria-label="Open appearance settings"
            title="Appearance"
          >
            {isDark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            <Settings2 className="w-3.5 h-3.5 -ml-1" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuRadioGroup
            value={theme ?? "system"}
            onValueChange={(value) => setTheme(value)}
          >
            <DropdownMenuRadioItem value="light">
              <Sun className="w-4 h-4" />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon className="w-4 h-4" />
              Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <Monitor className="w-4 h-4" />
              System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
