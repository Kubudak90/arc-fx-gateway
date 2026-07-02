<?php
/**
 * Verification matrix for the Arcora webhook trust boundary
 * (includes/class-wc-arcora-webhook.php).
 *
 * The webhook is the ONLY thing standing between a forged HTTP request and an
 * order being marked paid, so its signature check is security-critical. This
 * suite pins the verification decision of verify_timestamped_v2 (line 182) and
 * the verify_signature_v2 / verify_signature primitives it delegates to.
 *
 * All three verifiers are pure (hash_hmac + hash_equals) and are reached here via
 * reflection since they are private static. The REJECT branches of
 * verify_timestamped_v2 emit their 401 through respond(), which calls exit — not
 * catchable in-process — so the reject expectations are asserted at the
 * verify_signature_v2 seam (the exact check line 188 performs), and the ACCEPT
 * outcomes at verify_timestamped_v2. A bypass would live in the signature math,
 * which is fully covered; end-to-end HTTP-status assertions (the exit-driven 401
 * bodies) belong to a future handle() integration test using process isolation.
 */

declare(strict_types=1);

namespace Arcora\WooCommerce\Tests;

use Brain\Monkey;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;
use WC_Arcora_Webhook;

final class WebhookSignatureTest extends TestCase
{
    /** A realistic HMAC secret and a representative invoice.paid delivery body. */
    private const SECRET = 'whsec_5f4dcc3b5aa765d61d8327deb882cf99';
    private const BODY   = '{"type":"invoice.paid","invoice_id":"0xabc","tx_hash":"0xdeadbeef","paid_by":"0xC0ffee"}';

    protected function setUp(): void
    {
        parent::setUp();
        Monkey\setUp();
    }

    protected function tearDown(): void
    {
        Monkey\tearDown();
        parent::tearDown();
    }

    /** Invoke a private static verifier on the webhook class. */
    private static function call(string $method, array $args): bool
    {
        $ref = new ReflectionMethod(WC_Arcora_Webhook::class, $method);
        $ref->setAccessible(true);
        return (bool) $ref->invokeArgs(null, $args);
    }

    /** V2 header: sha256=HMAC("<timestamp>.<body>"). */
    private static function v2Sig(string $timestamp, string $body, string $secret): string
    {
        return 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $body, $secret);
    }

    /** Legacy header: sha256=HMAC(body). */
    private static function legacySig(string $body, string $secret): string
    {
        return 'sha256=' . hash_hmac('sha256', $body, $secret);
    }

    // ── The 7-case verify_signature_v2 matrix (line 182 → 188) ──────────────

    /** 1. A correctly signed body is accepted. */
    public function test_v2_accepts_a_correctly_signed_body(): void
    {
        $ts = '1716500000';
        $this->assertTrue(
            self::call('verify_signature_v2', [self::BODY, $ts, self::v2Sig($ts, self::BODY, self::SECRET), self::SECRET])
        );
    }

    /** 2. A signature made with the wrong secret is rejected. */
    public function test_v2_rejects_the_wrong_secret(): void
    {
        $ts = '1716500000';
        $forged = self::v2Sig($ts, self::BODY, 'whsec_attacker_guess');
        $this->assertFalse(self::call('verify_signature_v2', [self::BODY, $ts, $forged, self::SECRET]));
    }

    /** 3. A body altered after signing is rejected. */
    public function test_v2_rejects_a_tampered_body(): void
    {
        $ts  = '1716500000';
        $sig = self::v2Sig($ts, self::BODY, self::SECRET);
        $tampered = str_replace('0xabc', '0xEVIL', self::BODY);
        $this->assertFalse(self::call('verify_signature_v2', [$tampered, $ts, $sig, self::SECRET]));
    }

    /** 4. The timestamp is bound into the signature — changing it invalidates. */
    public function test_v2_rejects_a_tampered_timestamp(): void
    {
        $sig = self::v2Sig('1716500000', self::BODY, self::SECRET);
        $this->assertFalse(self::call('verify_signature_v2', [self::BODY, '1716599999', $sig, self::SECRET]));
    }

    /** 5. A header missing the `sha256=` prefix is rejected (never bare hex). */
    public function test_v2_rejects_a_header_without_the_sha256_prefix(): void
    {
        $ts  = '1716500000';
        $raw = hash_hmac('sha256', $ts . '.' . self::BODY, self::SECRET); // valid hex, no prefix
        $this->assertFalse(self::call('verify_signature_v2', [self::BODY, $ts, $raw, self::SECRET]));
    }

    /** 6. An empty signature header is rejected. */
    public function test_v2_rejects_an_empty_signature_header(): void
    {
        $this->assertFalse(self::call('verify_signature_v2', [self::BODY, '1716500000', '', self::SECRET]));
    }

    /** 7. A legacy-scheme signature (over body only) is not valid as V2. */
    public function test_v2_rejects_a_legacy_scheme_signature(): void
    {
        $ts     = '1716500000';
        $legacy = self::legacySig(self::BODY, self::SECRET);
        $this->assertFalse(self::call('verify_signature_v2', [self::BODY, $ts, $legacy, self::SECRET]));
    }

    // ── verify_timestamped_v2 ACCEPT paths (no respond()/exit) ──────────────

    /** An in-window, correctly signed delivery is accepted and emits no response. */
    public function test_timestamped_v2_accepts_an_in_window_valid_delivery(): void
    {
        $ts  = (string) time();
        $sig = self::v2Sig($ts, self::BODY, self::SECRET);
        Monkey\Functions\expect('status_header')->never(); // accept path never calls respond()
        $this->assertTrue(self::call('verify_timestamped_v2', [self::BODY, $ts, $sig, self::SECRET]));
    }

    /**
     * A timestamp near (but safely within) the tolerance is accepted. Uses
     * TOLERANCE-5 rather than the exact edge: a miss on this path would exit()
     * via respond() and kill the suite, and time() cannot be frozen for a
     * global-namespace callee, so the knife-edge itself is out of scope here.
     */
    public function test_timestamped_v2_accepts_a_timestamp_near_the_tolerance(): void
    {
        $ts  = (string) (time() - (WC_Arcora_Webhook::TIMESTAMP_TOLERANCE_SECONDS - 5));
        $sig = self::v2Sig($ts, self::BODY, self::SECRET);
        Monkey\Functions\expect('status_header')->never();
        $this->assertTrue(self::call('verify_timestamped_v2', [self::BODY, $ts, $sig, self::SECRET]));
    }

    // ── Legacy verify_signature parity ──────────────────────────────────────

    /** Legacy signature over the raw body is accepted. */
    public function test_legacy_accepts_a_correctly_signed_body(): void
    {
        $this->assertTrue(self::call('verify_signature', [self::BODY, self::legacySig(self::BODY, self::SECRET), self::SECRET]));
    }

    /** Legacy rejects the wrong secret, a tampered body, and a prefix-less header. */
    public function test_legacy_rejects_wrong_secret_tampered_body_and_bad_prefix(): void
    {
        $good = self::legacySig(self::BODY, self::SECRET);
        $this->assertFalse(self::call('verify_signature', [self::BODY, self::legacySig(self::BODY, 'nope'), self::SECRET]));
        $this->assertFalse(self::call('verify_signature', [str_replace('0xabc', '0xEVIL', self::BODY), $good, self::SECRET]));
        $this->assertFalse(self::call('verify_signature', [self::BODY, substr($good, 7), self::SECRET])); // hex, no prefix
    }
}
