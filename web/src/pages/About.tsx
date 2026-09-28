import { Badge, Page } from "../components/ui";

const author = "Isna Azis Nurohman";

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
          © {new Date().getFullYear()} {author}. All rights reserved.
        </p>
      </div>
    </Page>
  );
}
