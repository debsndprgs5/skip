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
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (key === "Berlin") {
          reject(new Error(`API error: city "${key}" not found`));
          return;
        }
        console.error(`[DEBUG] MeteoService.fetch called: ${JSON.stringify(key)}`);
        const temperatures: Record<string, number> = { Paris: 18, London: 14, Tokyo: 27 };
        const temp = temperatures[key as string] ?? 20;
        const result = { city: key, temperature: `${temp}°C` };
        console.error(`[DEBUG] MeteoService callback firing: ${JSON.stringify(key)}`);
        callbacks.update([result]).then(resolve).catch(reject);
      }, this.delayMs);
    });
  }

  shutdown(): Promise<void> {
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
    const results = this.meteo.getArray(key);
    if (results.length === 0) {
      return [[key, { type: "loading" }]];
    }
    return [[key, results[0]!]];
  }
}

// ─── Resource ─────────────────────────────────────────────────────────────────

class MeteoResource implements Resource<ResourceOutputs> {
  instantiate(cs: ResourceOutputs): EagerCollection<Json, Json> {
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
    const meteo = context.useLazyExternalResource<string, AsyncResult<Json>>({
      service: "meteo",
      identifier: "temperatures",
    });
    const cities = inputs.cities.map(CityMapper, meteo);
    return { cities };
  },
};

// ─── Run ──────────────────────────────────────────────────────────────────────

const server = await runService(service, {
  control_port: 3591,
  streaming_port: 3590,
  platform,
});

async function shutdown() {
  await server.close();
}

// eslint-disable-next-line @typescript-eslint/no-misused-promises
["SIGTERM", "SIGINT"].map((sig) => process.on(sig, shutdown));