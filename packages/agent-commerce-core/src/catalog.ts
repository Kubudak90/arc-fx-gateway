// packages/agent-commerce-core/src/catalog.ts
export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  /** Whole USDC, e.g. 3 means 3 USDC. */
  priceUsdc: number;
  emoji: string;
}

export const CATALOG: CatalogItem[] = [
  { id: "logo-pack", name: "AI Logo Pack", description: "10 AI-generated logo concepts with source files.", priceUsdc: 5, emoji: "🎨" },
  { id: "landing-copy", name: "Landing Page Copy", description: "Conversion-focused copy for one landing page.", priceUsdc: 3, emoji: "📝" },
  { id: "prompt-library", name: "Prompt Library (50)", description: "50 curated prompts for marketing and ops.", priceUsdc: 2, emoji: "📚" },
  { id: "strategy-call", name: "30-min Strategy Call", description: "A focused 30-minute strategy session.", priceUsdc: 10, emoji: "📞" },
];

export function findItem(id: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === id);
}
