async function main() {
  const q = async (city) => {
    const r = await fetch("http://localhost:3591/v1/snapshot/cities/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: city, params: {} }),
    });
    return r.json();
  };

  console.log("QUERY 1:", JSON.stringify(await q("Paris")));
  await new Promise(r => setTimeout(r, 1500));
  console.log("QUERY 2:", JSON.stringify(await q("Paris")));
}

main().then(() => process.exit(0));