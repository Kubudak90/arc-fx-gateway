// packages/agent-commerce-core/src/config.ts
export interface CommerceConfig {
  /** Secret merchant key (ak_live_…). Server-side only. */
  apiKey: string;
  /** Arcorapay API host, e.g. https://arcorapay.xyz */
  baseUrl: string;
  /** http(s) URL the buyer returns to after paying. Required by the SDK. */
  successUrl: string;
}

type EnvLike = Record<string, string | undefined>;

export function loadConfig(env: EnvLike = process.env): CommerceConfig {
  const apiKey = env.ARCORA_API_KEY;
  if (!apiKey) throw new Error("ARCORA_API_KEY is required");
  return {
    apiKey,
    baseUrl: env.ARCORA_BASE_URL ?? "https://arcorapay.xyz",
    successUrl: env.ARCORA_SUCCESS_URL ?? "https://arcorapay.xyz/thanks",
  };
}
