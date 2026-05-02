"use client";

import { useEffect, useState } from "react";

export type GateStatus = "idle" | "checking" | "allow" | "review" | "reject" | "error";

export interface GateState {
  status: GateStatus;
  ticketId?: string;
  reason?: string;
  code?: string;
}

/**
 * Calls `/api/checkout/authorize` after wallet connect, before the customer
 * signs the Permit2 message. The PayButton is gated on `status === "allow"`.
 */
export function useComplianceGate(invoiceId: string, address: string | undefined): GateState {
  const [state, setState] = useState<GateState>({ status: "idle" });

  useEffect(() => {
    if (!address) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "checking" });
    fetch("/api/checkout/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invoiceId, address }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (body?.decision === "allow") {
          setState({ status: "allow" });
        } else if (body?.decision === "review") {
          setState({ status: "review", ticketId: body.ticketId, reason: body.reason });
        } else if (body?.decision === "reject") {
          setState({ status: "reject", code: body.code, reason: body.reason });
        } else {
          // No decision in body (e.g. invoice_not_found) — surface as error.
          setState({ status: "error", reason: body?.error ?? `unexpected_status_${res.status}` });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: "error", reason: String(err?.message ?? err) });
      });
    return () => { cancelled = true; };
  }, [invoiceId, address]);

  return state;
}
