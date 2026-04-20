import { sleep } from "./utils.js";

const control = "http://localhost:3591";

async function query(city: string): Promise<void> {
  const res = await fetch(`${control}/v1/snapshot/cities/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: city, params: {} }),
  });
  const result = await res.json();
  console.log(JSON.stringify(result));
}

// First requests — expect loading
await query("Paris");
await query("London");
await query("Berlin");

// Wait for fetches to resolve
await sleep(1500);

// Second requests — expect value or error
await query("Paris");
await query("London");
await query("Berlin");
await query("Tokyo");

// Wait for Tokyo fetch
await sleep(1500);

// Tokyo should have value now
await query("Tokyo");