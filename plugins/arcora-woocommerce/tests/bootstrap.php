<?php
/**
 * PHPUnit bootstrap for the Arcora WooCommerce gateway.
 *
 * The webhook signature verifiers are pure PHP (hash_hmac + hash_equals) and
 * need no running WordPress, so this bootstrap only: (1) loads the Composer
 * autoloader (PHPUnit, Brain\Monkey, Mockery); (2) defines ABSPATH, which every
 * plugin file guards on before it will load; (3) requires the webhook class.
 *
 * The gateway class (class-wc-arcora-gateway.php) is deliberately NOT loaded — it
 * `extends WC_Payment_Gateway`, a WooCommerce class absent from this minimal
 * harness. The webhook class only references the gateway at runtime inside
 * handle(), which the unit suite does not call, so leaving it unloaded is safe.
 */

declare(strict_types=1);

$autoload = __DIR__ . '/../vendor/autoload.php';
if (!is_file($autoload)) {
    fwrite(STDERR, "Missing vendor/autoload.php — run `composer install` in plugins/arcora-woocommerce first.\n");
    exit(1);
}
require $autoload;

// Plugin files start with `if (!defined('ABSPATH')) { exit; }`.
if (!defined('ABSPATH')) {
    define('ABSPATH', sys_get_temp_dir() . '/');
}

require __DIR__ . '/../includes/class-wc-arcora-webhook.php';
