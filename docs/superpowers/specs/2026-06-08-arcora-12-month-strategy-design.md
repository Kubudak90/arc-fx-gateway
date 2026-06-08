# Arcora 12-Month Strategy Design

Date: 2026-06-08
Status: approved for planning

## Objective

Arcora's next 12 months should prove that it is an investable stablecoin
checkout company, not only a technically interesting Arc testnet project.

The primary outcome is a working cross-chain v2 product, credible pilot usage,
and a funding-ready package for a $1M-$1.5M pre-seed round. Arc/Circle ecosystem
grant funding should run in parallel and finance technical milestones without
making the pre-seed story dependent on grants alone.

## Strategic Posture

Use a milestone-gated dual track:

- Engineering leads the first 90 days.
- Product and GTM continue at a lightweight validation level.
- Every major expansion is tied to a technical, pilot, grant, or funding gate.
- Work that does not support v2, pilot traction, or mainnet readiness is out of
  scope for this 12-month cycle.

Q1 allocation is 85% code and 15% external validation. That external work is
limited to technical design partners, Arc/Circle grant activity, and a small
number of crypto-native B2B SaaS discovery calls.

## 12-Month Success Criteria

By month 12, Arcora should be able to show:

- Cross-chain payments from CCTP-supported EVM chains into Arc.
- A verified Base settlement fallback if Arc mainnet is delayed.
- Risk-based settlement windows of 0, 1, or 7 days.
- At least 5 active design partners.
- At least 3 merchants running live or controlled production payments.
- At least $100K in monthly payment volume.
- At least 95% successful settlement.
- At least 25% checkout-open to payment conversion.
- At least 2 paying merchants.
- At least one Arc/Circle ecosystem grant or official partner signal.
- An external audit completed or contracted.
- A data room, investor deck, live demo, and security package ready for a
  $1M-$1.5M pre-seed process.

## Stop/Go Gates

- If there are not 3 serious design partners by day 90, revise the ICP and
  positioning.
- If there is no end-to-end cross-chain payment by day 180, narrow source-chain
  scope and ship fewer routes well.
- If Arc mainnet timing is still unreliable by day 270, promote Base fallback to
  a production settlement track.
- If merchant usage has not materialized by month 12, do not invest in v3
  solver work, non-EVM sources, or broad token expansion.
- Do not open real high-volume payment flow before audit budget and remediation
  capacity exist.

## Year Plan

### Q1: v2.0 Code Spine

Goal: produce a real cross-chain settlement demo that investors, Arc/Circle, and
technical design partners can inspect.

Build:

- Cross-chain route abstraction.
- Shared adapter architecture for CCTP-supported EVM source chains.
- Base -> Arc end-to-end vertical slice.
- Ethereum -> Arc second validation route.
- Bridge -> Arc receive -> Arc-side swap -> `settleInvoice` state machine.
- Quote, expiry, slippage, timeout, refund, and idempotency behavior.
- Checkout telemetry for conversion, settlement time, and failure reason.
- Risk-based settlement data model, without full policy automation yet.
- Technical demo and security test package.

External work:

- 8-12 crypto-native B2B SaaS discovery calls.
- 2-3 design partner candidates invited to technical demos.
- Arc/Circle grant application prepared and submitted.

Gate:

- Real wallets can complete Base/Ethereum -> Arc cross-chain payment and
  settlement on the demo path.

### Q2: Productize and Pilot

Goal: turn v2.0 from a demo into a pilotable merchant product.

Build:

- Enable the remaining CCTP-supported EVM chains behind feature flags.
- Implement risk-based 0/1/7 day settlement.
- Add merchant pricing and billing.
- Add relayer failover and production-grade observability.
- Ship V12 contract fixes required for the next redeploy.
- Prepare multisig migration.

GTM:

- Onboard 3-5 design partners.
- Convert at least one pilot into a paying pilot.

Gate:

- 5 pilots, recurring payments on at least 2 source chains, and 95%+ settlement
  success.

### Q3: Production Hardening

Goal: make the system credible for controlled production and external audit.

Build:

- Use Arc mainnet if ready; otherwise activate the Base fallback production
  settlement track.
- Integrate KYB/compliance provider flow.
- Complete external audit and remediation.
- Add a second host/relayer path and incident runbooks.
- Build one high-leverage integration: Shopify or a SaaS billing integration.

GTM:

- Produce first case study from real or controlled production usage.

Gate:

- 3 production merchants, audit status clear, and measurable monthly payment
  volume.

### Q4: Fundraising Package

Goal: turn the product, security posture, and pilot usage into a pre-seed-ready
company narrative.

Deliver:

- 5+ active merchants.
- 2+ paying merchants.
- $100K+ monthly payment volume target.
- 95%+ settlement success.
- Checkout conversion and retention report.
- Pricing and unit-economics analysis.
- Data room, investor deck, live demo, security package, and grant/partner
  receipts.
- $1M-$1.5M pre-seed investor process.

## Technical Design

Q1 starts with the current centralized relayer for speed, but the architecture
must make bridge and settlement responsibilities separable in Q2.

Define three internal boundaries:

- Route planner: chooses source chain, source token, bridge route, Arc-side
  payout token, expiry, slippage, and merchant payout invariant.
- Bridge executor: moves source USDC to Arc through CCTP/App Kit Bridge.
- Settlement executor: verifies Arc-side funds, performs any Arc-side swap, and
  calls `settleInvoice`.

The first implementation can run these boundaries in the same daemon. The DB
state, queue rows, and TypeScript interfaces should be separated so Q2 can
deploy bridge and settlement relayers independently without rewriting the
payment state machine.

### Cross-Chain State Machine

Primary states:

```text
created -> authorized -> bridge_pending -> bridge_confirmed -> arc_swap_pending -> settle_pending -> paid
```

Failure states:

```text
bridge_failed
arc_swap_failed
settle_failed
refunded
expired
```

Rules:

- Every cross-chain payment uses one idempotency key.
- Arc settlement cannot start before bridge completion is verified.
- Merchant payout remains the invariant: `invoice.payoutToken` and
  `invoice.amountOut` are the merchant-selected target.
- Source chains are enabled by feature flag.
- Base and Ethereum are the first demo routes; other CCTP EVM chains are added
  through the same adapter shape.

## Risk-Based Settlement

Settlement windows are limited to 0, 1, or 7 days.

Default to 7 days. If the risk service is unavailable, fall back to 7 days.

Use a rule-based policy engine in the first version. No opaque scoring model is
needed for this cycle.

Inputs:

- Merchant age and KYB status.
- Completed transaction count and volume.
- Refund and dispute rate.
- Transaction amount.
- Source chain and token.
- Wallet compliance result.
- Operational anomalies.

Tiers:

- 7 days: new merchants, first transactions, high-value transactions, new source
  chain routes, or manual review.
- 1 day: KYB-complete merchants with clean refund history and recurring volume.
- 0 days: manually allowlisted low-risk merchants with strict transaction
  limits.

Contract direction:

- The settlement window must be locked per invoice at creation time, either as
  `claimableAt` or as an immutable policy tier.
- Merchant tier changes must not affect existing invoices.

Audit requirements:

- Log the policy decision and inputs.
- Cap maximum transaction size per tier.
- Disable automatic tier upgrades during the first production period.

## GTM and Pilot Design

The first ICP is global, crypto-native B2B SaaS and digital service companies.

Q1 GTM is validation only:

- 8-12 founder or ops-lead calls.
- 2-3 serious design partner candidates.
- Arc/Circle grant process.
- Pitch updated around a working v2 demo.

Q2 converts GTM into a pilot program.

Design partner criteria:

- Real stablecoin payment collection need.
- Cross-border customers or global user base.
- EVM-wallet customer segment.
- Integration possible in under one week.
- Low physical-fulfillment and chargeback complexity.
- Willingness to run controlled production payments.

Pilot commercial structure:

- Discounted SaaS plan plus transaction fee.
- Clear disclosure of testnet/mainnet status and security boundaries.
- Optional joint case study.
- Feedback weekly in the first month, then every two weeks.

Metrics:

- Checkout count per merchant.
- Checkout-open to payment conversion.
- Settlement success rate.
- Average settlement time.
- Refund and failure rate.
- Support ticket count.
- Willingness to pay: free, discounted, or full price.

## Pricing Direction

Use SaaS plus low transaction fee:

- Monthly package for merchant access, dashboard, support, and integrations.
- Transaction fee around 0.2%-0.4% once usage moves beyond design-partner
  discounting.
- Design partners should receive discounted pricing, not a permanently free
  product, so willingness to pay is measurable.

## Team and Financing

Initial team:

- Founder: product, protocol architecture, investor and ecosystem partnerships.
- 1 protocol/backend engineer.
- Part-time product/GTM support.

After grant or Q1 technical gate:

- 1 frontend/product engineer.
- 1 protocol/infra engineer.
- Fractional legal/compliance.
- External smart-contract reviewer.

Pre-seed target team:

- 2 protocol/backend engineers.
- 1 frontend/product engineer.
- 1 infrastructure/security engineer.
- 1 partnerships/GTM lead.
- Fractional legal/compliance.

Use of funds:

- 45% engineering.
- 20% security, audit, and infrastructure.
- 15% GTM and ecosystem partnerships.
- 10% legal/compliance.
- 10% runway reserve.

Financing sequence:

1. Arc/Circle grant.
2. Technical v2 demo.
3. Design partner LOIs and pilots.
4. First controlled production volume.
5. $1M-$1.5M pre-seed.

Hiring gates:

- Do not hire beyond the initial core without grant funding or Q1 technical
  proof.
- If the grant does not land, continue with founder plus one engineer until the
  v2 demo and design partner signal justify more spend.

## Explicitly Out of Scope

For this 12-month strategy cycle, defer:

- v3 intent solver.
- Non-EVM sources.
- Broad token catalog expansion.
- Consumer wallet product.
- Broad e-commerce GTM before B2B SaaS pilots.
- Deep brand refresh before the v2 demo proves the core wedge.

## Open Implementation Planning Units

This strategy should be implemented through separate plans:

1. Q1 cross-chain v2 code spine.
2. Risk-based settlement and V12 contract changes.
3. Pilot program, pricing, and merchant instrumentation.
4. Mainnet/Base fallback readiness and security package.
5. Fundraising data room and investor narrative.
