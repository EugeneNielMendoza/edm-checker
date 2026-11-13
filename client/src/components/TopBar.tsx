import type { Theme } from "../hooks/useTheme";
import { MoonIcon, SunIcon } from "./Icons";

interface TopBarProps {
  theme: Theme;
  onToggleTheme: () => void;
}

export function TopBar({ theme, onToggleTheme }: TopBarProps) {
  const next = theme === "dark" ? "light" : "dark";
  return (
    <header className="z-10 flex h-[60px] items-center gap-3.5 border-b border-white/10 bg-topbar px-4 text-white md:sticky md:top-0 md:px-6">
      <a href="/" className="flex items-center gap-2.5 text-inherit no-underline" aria-label="Sesimi EDM Checker home">
        {/* SESIMI BRAND: text wordmark for now; replace with the official Sesimi_Wordmark SVG (white version). */}
        <span className="pb-[3px] text-2xl font-bold leading-none tracking-[-.035em] text-white">sesimi</span>
        <span className="h-[22px] w-px bg-white/25" aria-hidden="true" />
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          <span className="size-2 rounded-full bg-lime" aria-hidden="true" />
          EDM Checker
        </span>
      </a>
      <span className="ml-auto hidden text-[13px] text-white/70 md:inline">
        Render an EDM template and test it across email clients
      </span>
      <button
        type="button"
        onClick={onToggleTheme}
        aria-label={`Switch to ${next} mode`}
        title={`Switch to ${next} mode`}
        className="ml-auto grid size-9 flex-none place-items-center rounded-full border border-white/20 bg-transparent text-white transition-colors hover:border-white/40 hover:bg-white/10 focus-visible:outline-lime md:ml-1"
      >
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>
    </header>
  );
}
