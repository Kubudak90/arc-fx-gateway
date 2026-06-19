// Minor-unit money. Every on-chain stablecoin this router touches
// (USDC / EURC / USDT) is 6-decimal, so amounts are integers of micro-units.
//
// Invariant (PLAN §1): money is a `bigint` in minor units end to end. No float
// ever touches an amount — `number` cannot represent 6-dp decimals exactly and
// silently rounds. Decimal *strings* are the ONLY representation allowed at an
// edge (API request/response, CLI arg, log line). `parseUnits` / `formatUnits`
// are the only two crossings between the two worlds; nothing else parses money.

export const STABLE_DECIMALS = 6 as const;

// Branded bigint: a raw `bigint` cannot be passed where minor-units are expected
// without first going through `parseUnits` / `parseAmount`. This is a compile-time
// guard against unit mix-ups (e.g. passing a chainId or a wei value as money).
declare const MoneyBrand: unique symbol;
export type Money = bigint & { readonly [MoneyBrand]: never };

/** Construct a `Money` from a bigint already known to be minor units. */
export function money(minor: bigint): Money {
  if (typeof minor !== "bigint") throw new TypeError("money() takes a bigint of minor units");
  return minor as Money;
}

// Canonical decimal form: one or more digits, optionally a dot and one or more
// fractional digits. No sign, no exponent, no thousands separators, no bare ".5"
// or trailing "1." — the strictness is deliberate so a malformed amount fails
// loudly instead of being coerced into the wrong number of micro-units.
const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parse a decimal string into `Money` (minor units), exactly, with no float math.
 *
 * `parseUnits("1.5")      === 1_500_000n`
 * `parseUnits("0.000001") === 1n`
 * `parseUnits("0")        === 0n`
 *
 * Rejects: non-strings, signs, exponents, separators, and more fractional digits
 * than `decimals` (which would mean sub-micro precision the chain cannot hold).
 */
export function parseUnits(decimal: string, decimals: number = STABLE_DECIMALS): Money {
  if (typeof decimal !== "string") throw new TypeError("amount must be a decimal string");
  const s = decimal.trim();
  const m = DECIMAL_RE.exec(s);
  if (!m) throw new RangeError(`invalid decimal amount: ${JSON.stringify(decimal)}`);
  const whole = m[1] as string;
  const frac = m[2] ?? "";
  if (frac.length > decimals) {
    throw new RangeError(`amount "${s}" has more than ${decimals} fractional digits`);
  }
  const padded = frac.padEnd(decimals, "0");
  const scale = 10n ** BigInt(decimals);
  return (BigInt(whole) * scale + BigInt(padded || "0")) as Money;
}

/**
 * Format `Money` (minor units) back to its canonical decimal string. Round-trips
 * with `parseUnits`. Trailing fractional zeros are stripped (`1_500_000n → "1.5"`,
 * `1_000_000n → "1"`). A leading `-` is preserved for completeness, though payment
 * amounts are always non-negative.
 */
export function formatUnits(value: Money | bigint, decimals: number = STABLE_DECIMALS): string {
  if (typeof value !== "bigint") throw new TypeError("formatUnits takes a bigint");
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const body = frac.length ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${body}` : body;
}

/**
 * Parse an *invoice* amount: same as `parseUnits` but additionally enforces it is
 * strictly positive. This is the replacement for the old `amountUsdc: number`
 * (PLAN §6) — an invoice for 0 or a negative amount is never valid.
 */
export function parseAmount(decimal: string, decimals: number = STABLE_DECIMALS): Money {
  const v = parseUnits(decimal, decimals);
  if (v <= 0n) throw new RangeError(`invoice amount must be > 0, got ${JSON.stringify(decimal)}`);
  return v;
}

/** Narrowing guard. Note it only checks the runtime type (`bigint`). */
export function isMoney(v: unknown): v is Money {
  return typeof v === "bigint";
}
