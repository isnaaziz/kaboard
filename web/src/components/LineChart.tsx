import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";

export type Datum = { t: number; v: number };

type Props = {
  data: Datum[];
  color: string;
  format: (v: number) => string;
  height?: number;
};

const pad = { top: 12, right: 12, bottom: 24, left: 56 };

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const tickCount = 4;

const axis = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function niceStep(max: number) {
  const raw = Math.max(max, 1) / tickCount;
  const exp = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((s) => s * exp >= raw) ?? 10) * exp;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function LineChart({ data, color, format, height = 180 }: Props) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const gradient = useId();

  const geo = useMemo(() => {
    if (data.length < 2 || width === 0) return null;
    const w = width - pad.left - pad.right;
    const h = height - pad.top - pad.bottom;
    const t0 = data[0].t;
    const t1 = data[data.length - 1].t;
    const step = niceStep(Math.max(...data.map((d) => d.v)) * 1.05);
    const top = step * tickCount;
    const x = (t: number) => pad.left + ((t - t0) / Math.max(1, t1 - t0)) * w;
    const y = (v: number) => pad.top + h - (v / top) * h;
    const line = data.map((d, i) => `${i ? "L" : "M"}${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`).join("");
    const area = `${line}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`;
    const ticks = Array.from({ length: tickCount + 1 }, (_, i) => step * i);
    return { x, y, line, area, ticks, t0, t1, bottom: y(0) };
  }, [data, width, height]);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!geo) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < data.length; i++) if (Math.abs(geo.x(data[i].t) - px) < Math.abs(geo.x(data[best].t) - px)) best = i;
    setHover(best);
  };

  const point = hover !== null && geo ? data[hover] : null;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {!geo ? (
        <div className="grid h-full place-items-center text-xs text-zinc-500">Collecting samples…</div>
      ) : (
        <svg width={width} height={height} className="block touch-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {geo.ticks.map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={width - pad.right} y1={geo.y(v)} y2={geo.y(v)} stroke="#27272a" strokeDasharray={v ? "2 4" : undefined} />
              <text x={pad.left - 8} y={geo.y(v)} dy="0.32em" textAnchor="end" className="fill-zinc-500 text-[10px] tabular-nums">
                {axis.format(v)}
              </text>
            </g>
          ))}
          <text x={pad.left} y={height - 6} className="fill-zinc-500 text-[10px] tabular-nums">
            {clock(geo.t0)}
          </text>
          <text x={width - pad.right} y={height - 6} textAnchor="end" className="fill-zinc-500 text-[10px] tabular-nums">
            {clock(geo.t1)}
          </text>
          <path d={geo.area} fill={`url(#${gradient})`} />
          <path d={geo.line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {point && (
            <>
              <line x1={geo.x(point.t)} x2={geo.x(point.t)} y1={pad.top} y2={geo.bottom} stroke="#52525b" />
              <circle cx={geo.x(point.t)} cy={geo.y(point.v)} r={4} fill={color} stroke="#18181b" strokeWidth={2} />
            </>
          )}
        </svg>
      )}
      {point && geo && (
        <div
          className="pointer-events-none absolute top-1 z-10 flex -translate-x-1/2 flex-col gap-0.5 rounded-md border border-zinc-700 bg-zinc-900/95 px-2.5 py-1.5 text-xs shadow-lg whitespace-nowrap"
          style={{ left: Math.min(Math.max(geo.x(point.t), pad.left + 40), width - 50) }}
        >
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: color }} />
            <strong className="text-zinc-50 tabular-nums">{format(point.v)}</strong>
          </span>
          <span className="text-zinc-500 tabular-nums">{clock(point.t)}</span>
        </div>
      )}
    </div>
  );
}
