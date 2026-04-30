/**
 * Flat exports for the IIFE bundle, so a `<script>` tag user can write
 *   Arcora.init({ apiKey })
 *   Arcora.createInvoice({ … })
 *   Arcora.openCheckout(inv)
 * instead of the nested `window.Arcora.Arcora.init(…)` they'd get if we
 * IIFE'd the module shape directly.
 */
import { Arcora } from "./client";

export const init          = Arcora.init;
export const createInvoice = Arcora.createInvoice;
export const openCheckout  = Arcora.openCheckout;

export { ArcoraError, type ArcoraErrorCode } from "./error";
export type * from "./types";
