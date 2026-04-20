import type {
  Context,
  EagerCollection,
  Json,
  LazyCollection,
  Mapper,
  Resource,
  SkipService,
  AsyncResult,
  Values,
  Entry,
} from "@skipruntime/core";
import type { LazyExternalService } from "@skipruntime/core";
import { runService } from "@skipruntime/server";

const platform: "wasm" | "native" =
  process.env["SKIP_PLATFORM"] == "native" ? "native" : "wasm";

// ─── Lazy External Service ────────────────────────────────────────────────────

class MeteoService implements LazyExternalService {
  constructor(private readonly delayMs: number = 500) {}

  fetch(
    key: Json,
    callbacks: {
      update: (values: Json[]) => Promise<void>;
    },
  ): Promise<void> {
    console.log(`[MeteoService] fetch() called for key: ${JSON.stringify(key)}`);

    return new Promise((resolve, reject) => {
      setTimeout(() => {

        if (key === "Berlin") {
          console.log(`[MeteoService] Simulating error for key: ${JSON.stringify(key)}`);
          reject(new Error(`API error: city "${key}" not found`));
          return;
        }

        const temperatures: Record<string, number> = { Paris: 18, London: 14, Tokyo: 27 };
        const temp = temperatures[key as string] ?? 20;
        const result = { city: key, temperature: `${temp}°C` };
        console.log(`[MeteoService] fetch() completing for key: ${JSON.stringify(key)} → ${JSON.stringify(result)}`);
        callbacks.update([result]).then(resolve).catch(reject);
      }, this.delayMs);
    });
  }

  shutdown(): Promise<void> {
    console.log("[MeteoService] shutdown() called — marking service as stopped");
    return Promise.resolve();
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ResourceInputs = {
  cities: EagerCollection<string, string>;
};

type ResourceOutputs = {
  cities: EagerCollection<string, AsyncResult<Json>>;
};

// ─── Mapper ───────────────────────────────────────────────────────────────────

class CityMapper
  implements Mapper<string, string, string, AsyncResult<Json>>
{
  constructor(private readonly meteo: LazyCollection<string, AsyncResult<Json>>) {}

  mapEntry(
    key: string,
    _values: Values<string>,
  ): Iterable<[string, AsyncResult<Json>]> {
    console.log(`[CityMapper] mapEntry() called for key: "${key}"`);
    const results = this.meteo.getArray(key);
    console.log(`[CityMapper] meteo.getArray("${key}") returned: ${JSON.stringify(results)}`);

    if (results.length === 0) {
      return [[key, { type: "loading" }]];
    }
    return [[key, results[0]!]];
  }
}

// ─── Resource ─────────────────────────────────────────────────────────────────

class MeteoResource implements Resource<ResourceOutputs> {
  instantiate(cs: ResourceOutputs): EagerCollection<Json, Json> {
    console.log("[MeteoResource] instantiate() called");
    return cs.cities as unknown as EagerCollection<Json, Json>;
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

const service: SkipService<ResourceInputs, ResourceOutputs> = {
  initialData: {
    cities: [
      ["Paris", ["Paris"]],
      ["London", ["London"]],
      ["Tokyo", ["Tokyo"]],
      ["Berlin", ["Berlin"]],
      ["Madrid", ["Madrid"]],
    ] as Entry<string, string>[],
  },
  lazyExternalServices: { meteo: new MeteoService() },
  resources: { cities: MeteoResource },

  createGraph(inputs: ResourceInputs, context: Context): ResourceOutputs {
    console.log("[createGraph] Building reactive graph...");
    const meteo = context.useLazyExternalResource<string, AsyncResult<Json>>({
      service: "meteo",
      identifier: "temperatures",
    });
    console.log("[createGraph] LazyCollection created for meteo service");
    const cities = inputs.cities.map(CityMapper, meteo);
    console.log("[createGraph] EagerCollection mapped over LazyCollection");
    return { cities };
  },
};

// ─── Run ──────────────────────────────────────────────────────────────────────

console.log("[main] Starting lazy weather service...");

const server = await runService(service, {
  control_port: 3591,
  streaming_port: 3590,
  platform,
});

console.log("[main] Service started on ports 3590/3591");

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function query(city: string, label: string): Promise<void> {
  console.log(`\n[query] ${label} — requesting "${city}"...`);
  
  try {
    const response = await fetch("http://localhost:3591/v1/snapshot/cities/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: city,  
        params: {}
      })
    });

    if (!response.ok) {
      console.error(`[query] HTTP Error: ${response.status} ${response.statusText}`);
      return;
    }

    const result = await response.json();
    console.log(`[query] Result for "${city}": ${JSON.stringify(result)}`);
    
  } catch (error) {
    console.error(`[query] Fetch failed:`, error);
  }
}

// ─── Test sequence ────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════");
console.log("  First requests (expect loading)");
console.log("═══════════════════════════════════════");

await query("Paris", "First call");
await query("London", "First call");
await query("Berlin", "First call (will error)");

console.log("\n[main] Waiting 1.5s for fetches to complete...");
await sleep(1500);

console.log("\n═══════════════════════════════════════");
console.log("  Second requests (expect value or error)");
console.log("═══════════════════════════════════════");

await query("Paris", "Second call");
await query("London", "Second call");
await query("Berlin", "Second call (error expected)");
await query("Tokyo", "First call (not yet fetched)");

console.log("\n[main] Waiting 1.5s for Tokyo fetch to complete...");
await sleep(1500);

console.log("\n═══════════════════════════════════════");
console.log("  Tokyo after fetch");
console.log("═══════════════════════════════════════");

await query("Tokyo", "Second call (should have value now)");

console.log("\n[main] Done. Shutting down...");
// STEP 4 — close() while fetch in-flight
console.log("\n═══════════════════════════════════════");
console.log("  close() while fetch in-flight");
console.log("═══════════════════════════════════════\n");

// Close actual server (fetchs already resolved, proper close)
await server.close();
console.log("[main] Original server closed successfully");

// New service with a very slow fetch (3s)
const slowMeteo = new MeteoService(3000);
const slowServiceDef: SkipService<ResourceInputs, ResourceOutputs> = {
  ...service,
  lazyExternalServices: { meteo: slowMeteo },
};
const slowServer = await runService(slowServiceDef, {
  control_port: 3591,
  streaming_port: 3590,
  platform,
});
console.log("[main] Slow server started — 5 fetches are now in-flight (3s delay)");

// Closing while the 5 fetchs are in-flight
await sleep(100);
console.log("[main] Calling close() while all 5 fetches are in-flight...");
await slowServer.close();
console.log("[main] close() returned without throwing");

// Wait a long time past the delay to check that orphans fetchs properly come back
await sleep(3500);
console.log("[main] Survived 3.5s post-close — no crash from orphan callbacks");

process.exit(0);
