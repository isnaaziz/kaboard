import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

type Options = { align?: "left" | "right"; placement?: "auto" | "top"; matchWidth?: boolean };

const gap = 4;

export function usePopover<A extends HTMLElement, P extends HTMLElement>(open: boolean, close: () => void, { align = "left", placement = "auto", matchWidth = false }: Options = {}) {
  const anchor = useRef<A>(null);
  const panel = useRef<P>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const height = panel.current?.offsetHeight ?? 0;
    const below = window.innerHeight - r.bottom;
    const up = placement === "top" || (below < height + gap * 2 && r.top > below);
    setStyle({
      position: "fixed",
      ...(matchWidth && { minWidth: r.width }),
      ...(align === "right" ? { right: window.innerWidth - r.right } : { left: r.left }),
      ...(up ? { bottom: window.innerHeight - r.top + gap } : { top: r.bottom + gap }),
    });
  }, [open, align, placement, matchWidth]);

  useEffect(() => {
    if (!open) {
      setStyle({ position: "fixed", visibility: "hidden" });
      return;
    }
    const inside = (t: EventTarget | null) => t instanceof Node && (anchor.current?.contains(t) || panel.current?.contains(t));
    const onDown = (e: PointerEvent) => !inside(e.target) && close();
    const onScroll = (e: Event) => !inside(e.target) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  return { anchor, panel, style };
}
