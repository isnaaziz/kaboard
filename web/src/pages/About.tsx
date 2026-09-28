import { useState } from "react";
import { Badge, Page } from "../components/ui";

const author = { name: "Isna Azis Nurohman", github: "isnaaziz" };

const stack = [
  { group: "Backend", items: ["Go", "franz-go", "kadm", "chi", "CEL"] },
  { group: "Frontend", items: ["React", "TanStack Query", "TanStack Virtual", "Tailwind CSS", "Vite"] },
];

const features = [
  "Multi-cluster management with SASL and TLS",
  "Message browser with live tail, seek by offset or time",
  "Server-side CEL filtering",
  "Consumer group lag and offset reset",
  "Produce and replay messages",
];

export function About() {
  const [avatar, setAvatar] = useState(true);

  return (
    <Page title="About">
      <div className="flex max-w-3xl flex-col gap-6">
        <section className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-6">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-2xl font-bold text-white">K</span>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-zinc-50">Kaboard</h2>
              <Badge tone="info">v{__APP_VERSION__}</Badge>
            </div>
            <p className="text-zinc-400">A fast, lightweight web UI to explore, debug and operate Apache Kafka clusters.</p>
          </div>
        </section>

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-6">
          <div className="flex items-center gap-4">
            {avatar && (
              <img
                src={`https://github.com/${author.github}.png?size=96`}
                alt={author.name}
                className="size-12 rounded-full bg-zinc-800 ring-1 ring-zinc-700"
                onError={() => setAvatar(false)}
              />
            )}
            <div className="flex flex-col">
              <span className="text-xs text-zinc-500">Created by</span>
              <strong className="text-base font-semibold text-zinc-50">{author.name}</strong>
            </div>
          </div>
          <a
            href={`https://github.com/${author.github}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 font-medium text-zinc-100! transition hover:bg-zinc-700"
          >
            <GitHubIcon />
            github.com/{author.github}
          </a>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-6">
            <h3 className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">Features</h3>
            <ul className="flex flex-col gap-2 text-zinc-300">
              {features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className="text-indigo-400">•</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-6">
            <h3 className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">Built with</h3>
            {stack.map((s) => (
              <div key={s.group} className="flex flex-col gap-2">
                <span className="text-xs text-zinc-500">{s.group}</span>
                <div className="flex flex-wrap gap-1.5">
                  {s.items.map((i) => (
                    <Badge key={i}>{i}</Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <p className="text-xs text-zinc-600">
          © {new Date().getFullYear()} {author.name}. All rights reserved.
        </p>
      </div>
    </Page>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 fill-current" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
