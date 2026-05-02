import type { ComplianceProvider } from "./provider";
import type { Risk, ScreeningContext, ScreeningResult } from "./types";

/**
 * Elliptic Lens API adapter (mock-friendly). Real endpoint shape lives
 * behind the configured base URL; we keep the request body shape small and
 * documented here so calibration with their solutions team is mechanical.
 *
 * Score → Risk:  0–3 low · 4–6 medium · 7–9 high · sanctioned → sanctions.
 * Sanction lists requested: OFAC + EU (resolved 2026-05-02).
 */

const SANCTION_LISTS = ["OFAC", "EU"] as const;

export interface EllipticConfig {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface EllipticResponse {
  score?: number;
  sanctioned?: boolean;
  sanctionLists?: string[];
  reasons?: string[];
}

export class EllipticProvider implements ComplianceProvider {
  readonly name = "elliptic" as const;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(config: EllipticConfig) {
    if (!config.apiKey) {
      throw new Error("config_required: ELLIPTIC apiKey not set");
    }
    this.#apiKey = config.apiKey;
    this.#baseUrl = config.baseUrl ?? "https://aml-api.elliptic.co";
    this.#fetch = config.fetch ?? fetch;
  }

  async screenAddress(
    address: string,
    context: ScreeningContext,
  ): Promise<ScreeningResult> {
    const res = await this.#fetch(`${this.#baseUrl}/v2/wallet/synchronous`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.#apiKey,
      },
      body: JSON.stringify({
        subject: { address, asset: "ETH" },
        sanctionLists: SANCTION_LISTS,
        flow: context.flow,
      }),
    });

    if (!res.ok) {
      throw new Error(`provider_error: elliptic ${res.status}`);
    }

    const body = (await res.json()) as EllipticResponse;
    const score = typeof body.score === "number" ? body.score : 0;
    const sanctioned = body.sanctioned === true;
    const reasons: string[] = [];

    if (sanctioned) {
      const lists = (body.sanctionLists ?? []).join(",");
      reasons.push(`sanction_match${lists ? `: ${lists}` : ""}`);
    }
    for (const r of body.reasons ?? []) reasons.push(r);

    const risk: Risk = sanctioned
      ? "sanctions"
      : score >= 7 ? "high"
      : score >= 4 ? "medium"
      : "low";

    return {
      risk,
      reasons,
      providerScore: score,
      providerSnapshot: body,
      cachedAt: new Date(),
      ttlSeconds: 24 * 3600,
    };
  }
}
