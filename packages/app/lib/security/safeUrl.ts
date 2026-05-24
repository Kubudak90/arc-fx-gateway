import dns from "node:dns/promises";

/**
 * Audit M7 (2026-05-06): dns.lookup has no native timeout. Wrap it in a
 * Promise.race against a 3-second rejection so a stalled resolver doesn't
 * block the caller indefinitely.
 */
async function dnsLookupWithTimeout(
  hostname: string,
  timeoutMs = 3000,
): Promise<{ address: string; family: number }[]> {
  const lookup = dns.lookup(hostname, { all: true });
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("dns_timeout")), timeoutMs),
  );
  return Promise.race([lookup, timer]);
}

/**
 * Check whether a destination URL is safe to fetch from a server-side
 * worker. The intent: prevent SSRF when a merchant configures their
 * webhook URL — without these guards, a merchant could point us at
 * `http://169.254.169.254/...` (cloud metadata) or `http://10.0.0.1/...`
 * (internal admin) and read from our own infrastructure.
 *
 * Audit P2 (2026-05-03): the previous validator only ran `z.string().url()`,
 * accepting any URL syntax including private IPs and http schemes.
 *
 * Behaviour:
 *   - In production: only https is accepted.
 *   - In any environment: scheme must be http or https.
 *   - DNS resolves every A/AAAA record for the hostname; if ANY resolved
 *     IP falls in a private/loopback/link-local/CGN/cloud-metadata range,
 *     we reject. This handles DNS-rebind shenanigans where a public-looking
 *     hostname resolves to an internal IP.
 *
 * The merchant-controlled webhook payload still benefits from the daemon
 * applying its own outbound checks too — this guard is the first layer.
 */
export async function assertSafePublicUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid_url");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("unsupported_scheme");
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("https_required");
  }

  const records = await dnsLookupWithTimeout(parsed.hostname).catch((e: Error) => {
    throw new Error(e.message === "dns_timeout" ? "dns_timeout" : "dns_lookup_failed");
  });

  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new Error(`private_address_blocked:${record.address}`);
    }
  }
}

/**
 * Throws unless `candidate` URL's origin is in the merchant's allowlist.
 * Allowlist entries must already be normalized to `new URL(...).origin`
 * (scheme + host + port — no path, query, fragment). Caller is responsible
 * for pairing this with `assertSafePublicUrl` for SSRF protection — this
 * helper only checks the origin string, not the resolved IP.
 *
 * Audit H1 (2026-05-05): merchant-supplied successUrl/cancelUrl on
 * /api/invoices was previously accepted as any well-formed URL, allowing
 * the hosted checkout page to redirect customers to attacker-controlled
 * domains (open redirect / phishing).
 */
export function assertOriginAllowed(candidate: string, allowed: readonly string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("invalid_url");
  }
  if (!allowed.includes(parsed.origin)) {
    throw new Error(`origin_not_allowed:${parsed.origin}`);
  }
}

/** True for any IP in a non-public range — RFC1918, loopback, link-local, CGN, etc. */
export function isPrivateAddress(ip: string): boolean {
  // IPv4
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0)   return true;             // 0.0.0.0/8 "this network"
    if (a === 10)  return true;             // 10/8 RFC1918
    if (a === 127) return true;             // 127/8 loopback
    if (a === 169 && b === 254) return true; // 169.254/16 link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 RFC1918
    if (a === 192 && b === 168) return true; // 192.168/16 RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGN
    if (a >= 224)  return true;             // 224/4 multicast + 240/4 reserved
    return false;
  }
  // IPv6 — normalise lowercase, no leading zeros stripped
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fe80:")) return true;       // link-local
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // unique local fc00::/7
  if (v6.startsWith("ff"))  return true;         // multicast
  if (v6.startsWith("::ffff:")) {
    // IPv4-mapped IPv6, recurse on the v4 part
    const ipv4 = v6.replace(/^::ffff:/, "");
    return isPrivateAddress(ipv4);
  }
  // Audit App-L3 (2026-05-24): 6to4 (2002::/16) embeds an IPv4 address in
  // bits 16–47. A dual-stack resolver returning e.g. `2002:c0a8:0101::`
  // for a merchant-supplied hostname would have slipped past the older
  // check; recurse on the decoded v4 so RFC1918 / loopback / link-local
  // ranges are caught regardless of which transition mechanism wrapped
  // them.
  if (v6.startsWith("2002:")) {
    const segs = v6.split(":");
    if (segs.length >= 3) {
      const a = (segs[1] ?? "").padStart(4, "0");
      const b = (segs[2] ?? "").padStart(4, "0");
      const o1 = parseInt(a.slice(0, 2), 16);
      const o2 = parseInt(a.slice(2, 4), 16);
      const o3 = parseInt(b.slice(0, 2), 16);
      const o4 = parseInt(b.slice(2, 4), 16);
      if ([o1, o2, o3, o4].every(n => Number.isFinite(n))) {
        return isPrivateAddress(`${o1}.${o2}.${o3}.${o4}`);
      }
    }
  }
  return false;
}
