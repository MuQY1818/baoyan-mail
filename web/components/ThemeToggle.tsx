import { Moon, Sun } from "lucide-react";
import type React from "react";
import type { ThemeMode } from "../types";

export function ThemeToggle({
  onToggle,
  theme
}: {
  onToggle: () => void;
  theme: ThemeMode;
}): React.ReactElement {
  const isDark = theme === "dark";
  return (
    <button
      aria-label={isDark ? "切换到白昼模式" : "切换到夜间模式"}
      className={isDark ? "theme-float theme-float-dark" : "theme-float"}
      onClick={onToggle}
      type="button"
    >
      {isDark ? (
        <Sun aria-hidden="true" className="theme-float-icon" size={25} strokeWidth={1.9} />
      ) : (
        <Moon aria-hidden="true" className="theme-float-icon" size={25} strokeWidth={1.9} />
      )}
      <span className="theme-float-tooltip" aria-hidden="true">换主题</span>
    </button>
  );
}
