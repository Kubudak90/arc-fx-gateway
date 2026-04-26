# Loom walkthrough script — 5 minutes

For grant submission. Record after Plan 2b deploy is live.

## Beat 1: Install + integrate (60 s)

- Open terminal: `mkdir my-store && cd my-store && npm init -y && npm install @arc-fx/checkout-react react react-dom`
- Open VS Code, show `App.tsx` with the 3-line integration:
  ```tsx
  import { CheckoutButton } from "@arc-fx/checkout-react";
  // …
  <CheckoutButton apiKey={KEY} invoice={{ amountUsdc: 49.99, payInToken: "EURC", successUrl: "..." }}>
    Pay €49.99
  </CheckoutButton>
  ```
- `npm run dev` → click "Pay €49.99" → redirect to hosted checkout.

## Beat 2: Customer journey on desktop (60 s)

- On hosted checkout page, point out:
  - Coinbase-blue accent + 56px pill CTA — design language signals "fintech infra"
  - Big amount in display font: `€49.99`
  - "You pay" card with live FX rate (~46.04 EURC) — refreshes every 30 s
- Click "Connect wallet" → thirdweb modal → choose MetaMask extension.
- Approve EURC → pay → status flips to "Payment received" → 3 s redirect to merchant success URL.

## Beat 3: QR cross-device handoff (45 s)

- Reset to a fresh `/i/<another-invoice>`.
- Click "Pay with mobile wallet" → QR appears.
- Scan with phone camera → mobile browser opens same URL.
- On phone, MetaMask Mobile auto-detected → connect → pay.
- Desktop is polling — flips to "Payment received" automatically.

## Beat 4: Merchant dashboard (60 s)

- Visit `/m/login` → connect → SIWE sign.
- Land on dashboard, see invoice list with statuses (Pending / Paid / Expired).
- Click "+ New invoice" → fill amount → create → row appears with QR icon.
- Click QR icon on row → share dialog with print + copy. In-person POS use case.

## Beat 5: Settings + on-chain auth (45 s)

- Visit `/m/settings`.
- Generate API key → copy (single reveal).
- Click "Register on-chain" → sign tx in wallet → confirm.
- Click "Authorize delegate" → sign tx → confirm.
- Both badges flip to "Yes". This is the EIP-style on-chain delegation that lets the server submit invoices on the merchant's behalf without per-invoice signatures.

## Beat 6: Webhook delivery + on-chain proof (30 s)

- Open webhook.site or RequestBin → show received POST with `X-Arc-Signature: sha256=...`.
- Open Arc testnet explorer → search the latest tx → show `InvoicePaid` event.

## Outro (10 s)

"That's Arc FX Gateway — install, integrate, get paid in stablecoins on Arc Network. Open source, MIT licensed, live demo at [URL]."

---

## Recording tips

- Run on macOS Chrome at 1280×800 viewport for clean Loom framing.
- Hide bookmarks bar (`Cmd+Shift+B`).
- Pre-stage two browser tabs: dev console for the integration code; checkout for customer flow.
- Use a dedicated wallet pre-funded with ~5 EURC + ~1 USDC for gas.
- For the QR handoff beat, prop your phone in the camera frame so the scan is visible.

## Distribution

After recording:
1. Set Loom video to "Anyone with the link" (no auth wall).
2. Add link to root README under "Live demo".
3. Include in grant submission package.
