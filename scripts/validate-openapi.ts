// Validates the hand-maintained contract against the routes the app actually
// registers, so a new endpoint cannot ship undocumented.
import { createApp } from "../src/app.ts";

const document = await Bun.file(
  new URL("../openapi.json", import.meta.url),
).json();

if (document.openapi !== "3.1.0" || !document.info?.title || !document.paths)
  throw new Error("Invalid OpenAPI document");

const prefix = "/api/v1";
// Routes outside the versioned API: the contract only describes /api/v1.
const untracked = new Set(["/openapi.json", "/docs", "/health"]);

type Layer = {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
  name?: string;
  // Express 5 keeps no mount path string on the layer: a router mounted at "/"
  // is flagged with `slash`, and anything else has to be probed with a matcher.
  slash?: boolean;
  matchers?: ((path: string) => unknown)[];
};

const mountPath = (layer: Layer) =>
  !layer.slash && layer.matchers?.some((match) => match(prefix)) ? prefix : "";

function collect(stack: Layer[], base = ""): string[] {
  return stack.flatMap((layer) => {
    if (layer.route) {
      const path = `${base}${layer.route.path}`;
      return Object.keys(layer.route.methods)
        .filter((method) => method !== "_all")
        .map((method) => `${method.toUpperCase()} ${path}`);
    }
    if (layer.name === "router" && layer.handle?.stack)
      return collect(layer.handle.stack, base + mountPath(layer));
    return [];
  });
}

const app = createApp();
const registered = collect((app.router as unknown as { stack: Layer[] }).stack)
  .filter((entry) => !untracked.has(entry.split(" ")[1]!))
  .map((entry) => {
    const [method, path] = entry.split(" ");
    // Express uses :id, OpenAPI uses {id}.
    return `${method} ${path!.slice(prefix.length).replace(/:(\w+)/g, "{$1}")}`;
  })
  .sort();

const documented = Object.entries(document.paths as Record<string, object>)
  .flatMap(([path, item]) =>
    Object.keys(item)
      .filter((key) => key !== "parameters")
      .map((method) => `${method.toUpperCase()} ${path}`),
  )
  .sort();

const missing = registered.filter((entry) => !documented.includes(entry));
const extra = documented.filter((entry) => !registered.includes(entry));

if (missing.length || extra.length) {
  for (const entry of missing) console.error(`  undocumented: ${entry}`);
  for (const entry of extra) console.error(`  not implemented: ${entry}`);
  throw new Error(
    `OpenAPI is out of sync: ${missing.length} undocumented, ${extra.length} stale`,
  );
}

console.log(
  `OpenAPI ${document.info.version}: ${Object.keys(document.paths).length} paths, ${registered.length} operations in sync`,
);
