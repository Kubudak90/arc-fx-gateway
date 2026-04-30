<?php
/**
 * Arcora webhook receiver. Listens at /wc-api/wc_arcora_webhook (the standard
 * WooCommerce REST surface for payment-gateway callbacks). Verifies the
 * X-Arcora-Signature HMAC against the per-merchant secret stored in the
 * Arcora dashboard, then transitions the matching WooCommerce order status.
 */

if (!defined('ABSPATH')) {
    exit;
}

class WC_Arcora_Webhook {

    public static function register(): void {
        add_action('woocommerce_api_wc_arcora_webhook', [self::class, 'handle']);
    }

    public static function handle(): void {
        $body = file_get_contents('php://input');
        $sig  = isset($_SERVER['HTTP_X_ARCORA_SIGNATURE']) ? sanitize_text_field((string) $_SERVER['HTTP_X_ARCORA_SIGNATURE']) : '';
        $gateway = new WC_Arcora_Gateway();
        $secret  = (string) $gateway->get_option('webhook_secret');

        if ($secret === '') {
            self::respond(503, ['error' => 'webhook_secret_missing']);
        }

        if (!self::verify_signature($body, $sig, $secret)) {
            self::respond(401, ['error' => 'invalid_signature']);
        }

        $payload = json_decode($body, true);
        if (!is_array($payload) || empty($payload['type']) || empty($payload['invoice_id'])) {
            self::respond(400, ['error' => 'malformed_payload']);
        }

        $orders = wc_get_orders([
            'limit'      => 1,
            'meta_key'   => '_arcora_invoice_id',
            'meta_value' => $payload['invoice_id'],
            'meta_compare' => '=',
        ]);
        if (empty($orders)) {
            // Not necessarily an error — could be a webhook for an invoice
            // created from a different store. Reply 200 so Arcora doesn't
            // retry forever.
            self::respond(200, ['ok' => true, 'note' => 'order_not_found']);
        }
        $order = $orders[0];

        switch ($payload['type']) {
            case 'invoice.paid':
                if ($order->get_status() !== 'completed') {
                    $tx = isset($payload['tx_hash']) ? sanitize_text_field((string) $payload['tx_hash']) : '';
                    $payer = isset($payload['paid_by']) ? sanitize_text_field((string) $payload['paid_by']) : '';
                    $note = sprintf(
                        /* translators: 1: payer wallet, 2: tx hash */
                        __('Arcora settled on-chain. Payer: %1$s · Tx: %2$s', 'arcora-woocommerce'),
                        $payer, $tx
                    );
                    $order->payment_complete($tx);
                    $order->add_order_note($note);
                }
                break;

            case 'invoice.refunded':
                if ($order->get_status() !== 'refunded') {
                    $tx = isset($payload['tx_hash']) ? sanitize_text_field((string) $payload['tx_hash']) : '';
                    $order->update_status('refunded', sprintf(
                        /* translators: %s = on-chain refund tx hash */
                        __('Arcora processed an on-chain refund · Tx: %s', 'arcora-woocommerce'),
                        $tx
                    ));
                }
                break;

            default:
                // Unknown but valid — log + ack so Arcora moves on.
                $order->add_order_note(sprintf('Arcora webhook (unhandled type=%s) ack\'d.', sanitize_text_field((string) $payload['type'])));
                break;
        }

        self::respond(200, ['ok' => true]);
    }

    /**
     * X-Arcora-Signature is `sha256=<hex>` over the raw request body.
     */
    private static function verify_signature(string $body, string $sigHeader, string $secret): bool {
        if (strpos($sigHeader, 'sha256=') !== 0) {
            return false;
        }
        $given = substr($sigHeader, 7);
        $expected = hash_hmac('sha256', $body, $secret);
        return hash_equals($expected, $given);
    }

    /**
     * Tiny JSON responder so handle() reads top-down without nested noise.
     */
    private static function respond(int $code, array $body): void {
        status_header($code);
        header('Content-Type: application/json');
        echo wp_json_encode($body);
        exit;
    }
}
