import type { Metadata } from "next";
import CodeBlock from "@/components/CodeBlock";
import DocsFrame from "@/components/DocsFrame";
import { PUBLIC_API } from "@/lib/api";
import { TAGS, operations, refName, resolve, sample, typeLabel, type Operation, type Schema } from "@/content/reference";

export const metadata: Metadata = { title: "API reference", description: "Every CheqPay API endpoint, its scope, parameters and responses." };

const OPS = operations();
const GROUPS = TAGS.filter((t) => OPS.some((o) => o.tag === t.name)).map((t) => ({
  section: t.name,
  items: OPS.filter((o) => o.tag === t.name).map((o) => ({ href: `/reference/#${o.id}`, title: o.summary })),
}));

const BADGE: Record<string, string> = { GET: "badge-get", POST: "badge-post", PATCH: "badge-patch", PUT: "badge-patch", DELETE: "badge-delete" };

/** The spec's descriptions use `backticks` for names; show them as code. */
function Md({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") ? <code key={i} className="inline-code">{part.slice(1, -1)}</code> : part,
      )}
    </>
  );
}

function Fields({ schema }: { schema: Schema | null }) {
  const s = resolve(schema);
  if (!s?.properties) return null;
  const required = new Set<string>(s.required ?? []);
  return (
    <table className="table mt-2">
      <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
      <tbody>
        {Object.entries(s.properties as Record<string, Schema>).map(([name, p]) => (
          <tr key={name}>
            <td className="whitespace-nowrap font-mono text-[13px]">{name}{required.has(name) && <span className="ml-1 text-bad">*</span>}</td>
            <td className="whitespace-nowrap font-mono text-[12px] text-muted">{typeLabel(p)}</td>
            <td className="text-[14px]">
              <Md text={p.description} />
              {p.enum && <div className="mt-1 font-mono text-[12px] text-muted">{p.enum.join(" · ")}</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function curlFor(o: Operation): string {
  const pattern = String(o.parameters.find((p) => p.in === "path")?.schema?.pattern ?? "");
  const prefix = /^\^([a-z]+)_/.exec(pattern)?.[1];
  const path = o.path.replace("{id}", prefix ? `${prefix}_…` : "…");
  const lines = [`curl${o.method === "GET" ? "" : ` -X ${o.method}`} ${PUBLIC_API}${path} \\`, `  -H "Authorization: Bearer $CHEQPAY_KEY"`];
  if (o.method !== "GET") lines[1] += " \\";
  if (o.method !== "GET") lines.push(`  -H "Idempotency-Key: $(uuidgen)"${o.body ? " \\" : ""}`);
  if (o.body && !o.body.properties?.file) {
    lines.push(`  -H "Content-Type: application/json" \\`, `  -d '${JSON.stringify(sample(o.body))}'`);
  }
  return lines.join("\n");
}

export default function Reference() {
  return (
    <DocsFrame groups={GROUPS}>
      <div className="appear max-w-3xl">
        <h1 className="title-lg">API reference</h1>
        <p className="subhead mt-2 text-[17px]">
          Base URL <code className="inline-code">{PUBLIC_API}</code>. Download the <a className="link" href="/openapi.json">OpenAPI document</a> to
          import into Postman or generate a client.
        </p>
        {GROUPS.map((g) => (
          <section key={g.section} className="mt-12">
            <h2 className="title">{g.section}</h2>
            <p className="subhead mt-1">{TAGS.find((t) => t.name === g.section)?.description}</p>
            {OPS.filter((o) => o.tag === g.section).map((o) => (
              <article key={o.id} id={o.id} className="mt-8 scroll-mt-24 border-t border-border/60 pt-6">
                <h3 className="headline text-[19px]">{o.summary}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={BADGE[o.method] ?? "badge"}>{o.method}</span>
                  <code className="font-mono text-[14px]">{o.path}</code>
                  <span className="pill bg-circle text-muted">scope {o.scope}</span>
                  {o.money && <span className="pill bg-warn/12 text-warn">moves money</span>}
                </div>
                <p className="mt-3 text-[15px] leading-relaxed"><Md text={o.description} /></p>
                {o.parameters.filter((p) => p.in !== "header").length > 0 && (
                  <>
                    <h4 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-muted">Parameters</h4>
                    <table className="table mt-2">
                      <tbody>
                        {o.parameters.filter((p) => p.in !== "header").map((p) => (
                          <tr key={`${p.in}-${p.name}`}>
                            <td className="whitespace-nowrap font-mono text-[13px]">{p.name}{p.required && <span className="ml-1 text-bad">*</span>}</td>
                            <td className="text-[12px] text-muted">{p.in}</td>
                            <td className="text-[14px]">{p.description ? <Md text={p.description} /> : p.schema?.enum ? p.schema.enum.join(" · ") : typeLabel(p.schema)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                {o.body && (
                  <>
                    <h4 className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-muted">Body</h4>
                    <Fields schema={o.body} />
                  </>
                )}
                <CodeBlock code={curlFor(o)} />
                <h4 className="mt-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Responses</h4>
                <ul className="mt-2 space-y-1.5 text-[14px]">
                  {o.responses.map((r) => (
                    <li key={r.status} className="flex gap-3">
                      <span className={`w-10 shrink-0 font-mono font-semibold ${r.status.startsWith("2") ? "text-good" : "text-bad"}`}>{r.status}</span>
                      <span>
                        <Md text={r.description} />
                        {r.status.startsWith("2") && refName(r.schema) && <span className="text-muted"> Returns {refName(r.schema)}.</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        ))}
      </div>
    </DocsFrame>
  );
}
