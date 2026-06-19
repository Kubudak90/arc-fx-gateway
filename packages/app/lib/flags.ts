// v2 chain-agnostic router rollout flag (PLAN integration §3). Off by default —
// the v1 custody path stays authoritative until this is on. Server code reads
// V2_ENABLED; client/components read NEXT_PUBLIC_V2_ENABLED (must be inlined at
// build time by Next.js). Never route one invoice through both models.
const truthy = (v: string | undefined) => v === "1" || v === "true";
export const V2_ENABLED = truthy(process.env.V2_ENABLED);
export const V2_ENABLED_CLIENT = truthy(process.env.NEXT_PUBLIC_V2_ENABLED);
