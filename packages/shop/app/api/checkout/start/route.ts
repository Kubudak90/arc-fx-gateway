import { NextRequest, NextResponse } from "next/server";

interface CartItem {
  sku:    string;
  name:   string;
  price:  number;
  qty:    number;
  size?:  string;
}

interface ShippingAddress {
  email:      string;
  fullName:   string;
  line1:      string;
  line2?:     string;
  city:       string;
  postalCode: string;
  country:    string;
}

interface CheckoutBody {
  items:   CartItem[];
  address: ShippingAddress;
  payIn:   "USDC" | "EURC";
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ARCORA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "shop_not_configured" }, { status: 500 });
  }
  const arcoraBase = process.env.ARCORA_BASE_URL ?? "https://arcorapay.xyz";

  let body: CheckoutBody;
  try {
    body = (await req.json()) as CheckoutBody;
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "cart_empty" }, { status: 400 });
  }
  if (body.payIn !== "USDC" && body.payIn !== "EURC") {
    return NextResponse.json({ error: "bad_pay_token" }, { status: 400 });
  }
  const a = body.address;
  if (!a?.email || !a.fullName || !a.line1 || !a.city || !a.postalCode || !a.country) {
    return NextResponse.json({ error: "address_incomplete" }, { status: 400 });
  }

  const subtotal = body.items.reduce(
    (acc, i) => acc + i.price * i.qty,
    0,
  );
  // Round to cents — Arcora's amountUsdc accepts a JSON number. We cap qty to
  // 10/line in the UI so worst-case 4 lines × 10 × 9.99 = $399.60. Comfortable
  // under any reasonable testnet ceiling.
  const amountUsdc = Math.round(subtotal * 100) / 100;

  const origin =
    process.env.NEXT_PUBLIC_SHOP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    ?? new URL(req.url).origin;

  const successUrl = `${origin}/success`;
  const cancelUrl  = `${origin}/cart`;

  // Audit #39: previously `Math.random()` + `Date.now()` — fine for low
  // volume, but Math.random isn't collision-resistant and two carts
  // submitted in the same ms with adjacent PRNG state would clash. UUIDs
  // give us 122 bits of entropy with no extra round-trip.
  const orderRef = `shop_${crypto.randomUUID()}`;

  // Arcora's /api/invoices accepts `metadata: Record<string,string>` only —
  // no nested objects or arrays. Flatten cart line items to a JSON-encoded
  // string and shipping fields to flat shipping_* keys so the operator can
  // read every order detail straight off /m/dashboard's invoice metadata
  // view.
  const itemsCompact = body.items.map(i => ({
    sku:       i.sku,
    name:      i.name,
    qty:       i.qty,
    size:      i.size,
    lineTotal: +(i.price * i.qty).toFixed(2),
  }));
  const itemsSummary = body.items
    .map(i => `${i.qty}× ${i.name}${i.size ? ` (${i.size})` : ""}`)
    .join(", ");

  const metadata: Record<string, string> = {
    source:            "arcora-shop",
    order_ref:         orderRef,
    items_summary:     itemsSummary,
    items_json:        JSON.stringify(itemsCompact),
    shipping_email:    a.email,
    shipping_name:     a.fullName,
    shipping_line1:    a.line1,
    shipping_city:     a.city,
    shipping_postal:   a.postalCode,
    shipping_country:  a.country,
  };
  if (a.line2) metadata.shipping_line2 = a.line2;

  let arcoraRes: Response;
  try {
    arcoraRes = await fetch(`${arcoraBase}/api/invoices`, {
      method:  "POST",
      headers: {
        "content-type":    "application/json",
        "X-Arcora-Api-Key": apiKey,
      },
      body: JSON.stringify({
        amountUsdc,
        payInToken: body.payIn,
        successUrl,
        cancelUrl,
        metadata,
      }),
    });
  } catch (e) {
    return NextResponse.json({
      error:   "arcora_unreachable",
      message: e instanceof Error ? e.message : String(e),
    }, { status: 502 });
  }

  const arcoraJson = await arcoraRes.json().catch(() => ({}));
  if (!arcoraRes.ok) {
    return NextResponse.json({
      error:   "arcora_create_failed",
      status:  arcoraRes.status,
      detail:  arcoraJson,
    }, { status: 502 });
  }

  return NextResponse.json({
    invoiceId: arcoraJson.invoiceId,
    url:       arcoraJson.url,
    orderRef,
  });
}
