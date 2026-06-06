const http = require("node:http");
const dns = require("node:dns");
const dnsPromises = dns.promises;

async function main() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      console.log(JSON.stringify({
        internalServerReached: true,
        method: req.method,
        host: req.headers.host,
        body,
      }));
      res.writeHead(204).end();
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;
  const hostname = "afg001-rebind.invalid";
  const originalLookup = dns.lookup;
  const originalPromiseLookup = dnsPromises.lookup;
  let safetyLookups = 0;
  let fetchLookups = 0;

  dnsPromises.lookup = async (name, options) => {
    if (name === hostname) {
      safetyLookups++;
      return [{ address: "93.184.216.34", family: 4 }];
    }
    return originalPromiseLookup(name, options);
  };

  dns.lookup = (name, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (name === hostname) {
      fetchLookups++;
      if (options?.all) {
        return process.nextTick(callback, null, [{ address: "127.0.0.1", family: 4 }]);
      }
      return process.nextTick(callback, null, "127.0.0.1", 4);
    }
    return originalLookup(name, options, callback);
  };

  try {
    const checked = await dnsPromises.lookup(hostname, { all: true });
    console.log(JSON.stringify({ safetyLookup: checked }));
    const response = await fetch(`http://${hostname}:${port}/admin/action`, {
      method: "POST",
      body: JSON.stringify({ type: "invoice.paid" }),
      headers: { "content-type": "application/json" },
      redirect: "manual",
    });
    console.log(JSON.stringify({
      fetchStatus: response.status,
      safetyLookups,
      fetchLookups,
    }));
    await response.body?.cancel();
  } finally {
    dns.lookup = originalLookup;
    dnsPromises.lookup = originalPromiseLookup;
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
