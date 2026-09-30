import { useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePopover } from "./popover";
import { cx } from "./ui";

export type Option<T> = { value: T; label: ReactNode; disabled?: boolean };

type Props<T> = {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  align?: "left" | "right";
  className?: string;
  "aria-label"?: string;
};

export function Select<T extends string | number>({ value, options, onChange, placeholder = "Select…", disabled, align = "left", className, ...rest }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const close = useCallback(() => setOpen(false), []);
  const { anchor, panel: list, style } = usePopover<HTMLButtonElement, HTMLUListElement>(open, close, { align, matchWidth: true });
  const id = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const show = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  };

  const pick = (o: Option<T>) => {
    if (o.disabled) return;
    onChange(o.value);
    setOpen(false);
  };

  const move = (dir: number) => {
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i].disabled) break;
    }
    setActive(i);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        if (open) move(e.key === "ArrowDown" ? 1 : -1);
        else show();
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (open && options[active]) pick(options[active]);
        else show();
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
        break;
      case "Tab":
        setOpen(false);
    }
  };

  return (
    <div className={className}>
      <button
        ref={anchor}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={rest["aria-label"]}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className={cx(
          "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border bg-zinc-900 px-2.5 py-1.5 text-left text-zinc-100 outline-none transition",
          "hover:border-zinc-700 focus-visible:border-indigo-500 focus-visible:ring-1 focus-visible:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50",
          open ? "border-indigo-500 ring-1 ring-indigo-500/40" : "border-zinc-800",
        )}
      >
        <span className={cx("truncate", !current && "text-zinc-600")}>{current?.label ?? placeholder}</span>
        <svg viewBox="0 0 16 16" className={cx("size-3.5 shrink-0 text-zinc-500 transition", open && "rotate-180")} aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        createPortal(
          <ul
            id={id}
            ref={list}
            role="listbox"
            style={style}
            className="animate-pop-in z-[95] max-h-64 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl shadow-black/20"
          >
            {options.map((o, i) => {
              const selected = o.value === value;
              return (
                <li
                  key={String(o.value)}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={o.disabled}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(o)}
                  className={cx(
                    "flex cursor-pointer items-center justify-between gap-4 rounded-md px-2.5 py-1.5 whitespace-nowrap",
                    i === active && "bg-zinc-800",
                    selected ? "text-zinc-50" : "text-zinc-300",
                    o.disabled && "cursor-not-allowed opacity-40",
                  )}
                >
                  {o.label}
                  <svg viewBox="0 0 16 16" className={cx("size-3.5 text-indigo-400", !selected && "invisible")} aria-hidden="true">
                    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}

export const options = <T extends string | number>(values: readonly T[], label: (v: T) => ReactNode = (v) => String(v)): Option<T>[] =>
  values.map((value) => ({ value, label: label(value) }));
