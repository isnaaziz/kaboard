import { useEffect, useState } from "react";
import { cx } from "./components/ui";

export type ThemePref = "system" | "light" | "dark";

const storageKey = "kaboard-theme";
const media = window.matchMedia("(prefers-color-scheme: light)");

function stored(): ThemePref {
  try {
    const v = localStorage.getItem(storageKey);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function persist(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, pref);
  } catch {
    return;
  }
}

function apply(pref: ThemePref) {
  document.documentElement.dataset.theme = pref === "system" ? (media.matches ? "light" : "dark") : pref;
}

export function useTheme() {
  const [pref, setPref] = useState(stored);

  useEffect(() => {
    apply(pref);
    persist(pref);
    if (pref !== "system") return;
    const follow = () => apply("system");
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [pref]);

  return [pref, setPref] as const;
}

const choices: { value: ThemePref; label: string; icon: string }[] = [
  { value: "system", label: "System", icon: "M3 5h18v11H3zM8 20h8M12 16v4" },
  { value: "light", label: "Light", icon: "M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" },
  { value: "dark", label: "Dark", icon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" },
];

export function ThemeToggle({ className }: { className?: string }) {
  const [pref, setPref] = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={cx("flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5", className)}>
      {choices.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={pref === c.value}
          aria-label={c.label}
          title={c.label}
          onClick={() => setPref(c.value)}
          className={cx(
            "grid flex-1 cursor-pointer place-items-center rounded-md py-1.5 transition",
            pref === c.value ? "bg-zinc-800 text-zinc-50 shadow-sm" : "text-zinc-500 hover:text-zinc-200",
          )}
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={c.icon} />
          </svg>
        </button>
      ))}
    </div>
  );
}
