<?php
/**
 * Scriptyard OAuth token broker — STATELESS.
 *
 * A cryptographic intermediary between the browser client and Google's OAuth
 * token endpoint. It holds only two secrets (Google client secret + a symmetric
 * encryption key), both read at request time from a config file discovered
 * OUTSIDE the web root. It never persists anything: no database, no files, no
 * sessions, no logs of token material. All transaction state dies with the
 * PHP request.
 *
 * Endpoints (single file, form-encoded POST to avoid CORS preflight):
 *   POST action=exchange  code=<google auth code> [redirect_uri=postmessage]
 *     -> { access_token, expires_in, encrypted_refresh_token? }
 *   POST action=refresh   encrypted_refresh_token=<blob>
 *     -> { access_token, expires_in }
 *   GET  ?action=health
 *     -> { status, config, crypto }   (setup diagnostics; leaks no paths)
 *
 * Client contract:
 *   - The encrypted_refresh_token blob is opaque to the client; it can only be
 *     used by POSTing it back here. The symmetric key never leaves the server.
 *   - HTTP 401 with error=invalid_grant means the underlying refresh token is
 *     dead (revoked/expired) — the client should discard its blob and re-run
 *     the interactive consent flow.
 *   - HTTP 400 with error=invalid_payload means the blob can't be decrypted
 *     (e.g. the server key was rotated) — same client recovery: discard and
 *     re-consent.
 */

declare(strict_types=1);

// Never leak PHP errors into responses: stack traces would expose filesystem
// paths, and the account username in those paths is itself treated as secret.
ini_set('display_errors', '0');
set_exception_handler(function (Throwable $e): void {
    http_response_code(500);
    echo json_encode(['error' => 'internal_error']);
});

const CONFIG_FILENAME = 'scriptyard-auth.config.php';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
// Bound into the AEAD so a blob can't be replayed into some other decryption
// context if this key were ever reused elsewhere.
const AEAD_CONTEXT = 'scriptyard-refresh-token';
const PAYLOAD_V_SODIUM = 'v1s'; // XChaCha20-Poly1305 (libsodium)
const PAYLOAD_V_GCM    = 'v1g'; // AES-256-GCM (OpenSSL fallback)

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/* ── Response helpers ────────────────────────────────────────────────────── */

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

function fail(int $status, string $error, string $description = ''): void
{
    $body = ['error' => $error];
    if ($description !== '') {
        $body['error_description'] = $description;
    }
    respond($status, $body);
}

/* ── Config discovery ────────────────────────────────────────────────────── */

/**
 * Candidate "home" directories, most authoritative first. Everything here is
 * derived at runtime so the hosting account name never appears in this repo.
 */
function homeCandidates(): array
{
    $homes = [];
    if (!empty($_SERVER['HOME'])) {
        $homes[] = $_SERVER['HOME'];
    }
    $env = getenv('HOME');
    if ($env !== false && $env !== '') {
        $homes[] = $env;
    }
    if (function_exists('posix_getpwuid') && function_exists('posix_geteuid')) {
        $info = posix_getpwuid(posix_geteuid());
        if (!empty($info['dir'])) {
            $homes[] = $info['dir'];
        }
    }
    if (!empty($_SERVER['DOCUMENT_ROOT'])) {
        $homes[] = dirname($_SERVER['DOCUMENT_ROOT']);
    }
    return array_values(array_unique($homes));
}

/**
 * True if $path resolves to somewhere under (or at) the document root, i.e.
 * somewhere the web server could be asked to serve. Secrets found there are
 * refused outright rather than trusted-but-risky.
 */
function isInsideDocRoot(string $path): bool
{
    if (empty($_SERVER['DOCUMENT_ROOT'])) {
        return false;
    }
    $docRoot = realpath($_SERVER['DOCUMENT_ROOT']);
    $real = realpath($path);
    if ($docRoot === false || $real === false) {
        return false;
    }
    return $real === $docRoot
        || strpos($real, $docRoot . DIRECTORY_SEPARATOR) === 0;
}

/**
 * Search order:
 *   1. Ancestors of this script's directory, walking upward. The first few
 *      levels sit inside the web root and are rejected by isInsideDocRoot();
 *      the walk escapes into the account home where the config really lives.
 *   2. Conventional home locations: ~/scriptyard-auth.config.php and
 *      ~/.config/scriptyard/auth.config.php.
 */
function findConfigFile(): ?string
{
    $candidates = [];

    $dir = __DIR__;
    for ($i = 0; $i < 8; $i++) {
        $candidates[] = $dir . DIRECTORY_SEPARATOR . CONFIG_FILENAME;
        $parent = dirname($dir);
        if ($parent === $dir) {
            break;
        }
        $dir = $parent;
    }

    foreach (homeCandidates() as $home) {
        $candidates[] = $home . DIRECTORY_SEPARATOR . CONFIG_FILENAME;
        $candidates[] = $home . DIRECTORY_SEPARATOR . '.config'
            . DIRECTORY_SEPARATOR . 'scriptyard'
            . DIRECTORY_SEPARATOR . 'auth.config.php';
    }

    foreach (array_unique($candidates) as $path) {
        if (!is_file($path) || !is_readable($path)) {
            continue;
        }
        if (isInsideDocRoot($path)) {
            continue;
        }
        return $path;
    }
    return null;
}

/**
 * Returns [configArray|null, errorCode]. Error strings deliberately contain
 * no filesystem paths.
 */
function tryLoadConfig(): array
{
    $path = findConfigFile();
    if ($path === null) {
        return [null, 'config_missing'];
    }
    $config = require $path;
    if (!is_array($config)) {
        return [null, 'config_invalid'];
    }
    foreach (['google_client_id', 'google_client_secret', 'encryption_key_hex'] as $required) {
        if (empty($config[$required]) || !is_string($config[$required])) {
            return [null, 'config_invalid'];
        }
    }
    $key = @hex2bin($config['encryption_key_hex']);
    if ($key === false || strlen($key) !== 32) {
        return [null, 'config_invalid'];
    }
    $config['encryption_key'] = $key;
    if (!isset($config['allowed_origins']) || !is_array($config['allowed_origins'])) {
        $config['allowed_origins'] = [];
    }
    return [$config, ''];
}

/* ── Symmetric encryption of the refresh token ───────────────────────────── */

function b64urlEncode(string $bin): string
{
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function b64urlDecode(string $str)
{
    return base64_decode(strtr($str, '-_', '+/'), true);
}

function sodiumAeadAvailable(): bool
{
    return function_exists('sodium_crypto_aead_xchacha20poly1305_ietf_encrypt');
}

function encryptRefreshToken(string $plain, string $key): string
{
    if (sodiumAeadAvailable()) {
        $nonce = random_bytes(SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_NPUBBYTES);
        $cipher = sodium_crypto_aead_xchacha20poly1305_ietf_encrypt($plain, AEAD_CONTEXT, $nonce, $key);
        return PAYLOAD_V_SODIUM . '.' . b64urlEncode($nonce) . '.' . b64urlEncode($cipher);
    }
    $iv = random_bytes(12);
    $tag = '';
    $cipher = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, AEAD_CONTEXT);
    if ($cipher === false) {
        fail(500, 'crypto_unavailable', 'Neither libsodium nor OpenSSL AES-GCM is usable');
    }
    return PAYLOAD_V_GCM . '.' . b64urlEncode($iv) . '.' . b64urlEncode($cipher . $tag);
}

function decryptRefreshToken(string $payload, string $key): ?string
{
    $parts = explode('.', $payload);
    if (count($parts) !== 3) {
        return null;
    }
    [$version, $nonceB64, $cipherB64] = $parts;
    $nonce = b64urlDecode($nonceB64);
    $cipher = b64urlDecode($cipherB64);
    if ($nonce === false || $cipher === false) {
        return null;
    }

    if ($version === PAYLOAD_V_SODIUM) {
        if (!sodiumAeadAvailable()) {
            return null;
        }
        $plain = sodium_crypto_aead_xchacha20poly1305_ietf_decrypt($cipher, AEAD_CONTEXT, $nonce, $key);
        return $plain === false ? null : $plain;
    }
    if ($version === PAYLOAD_V_GCM) {
        if (strlen($cipher) <= 16) {
            return null;
        }
        $tag = substr($cipher, -16);
        $ct = substr($cipher, 0, -16);
        $plain = openssl_decrypt($ct, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $nonce, $tag, AEAD_CONTEXT);
        return $plain === false ? null : $plain;
    }
    return null;
}

/* ── Google token endpoint ───────────────────────────────────────────────── */

/**
 * POSTs to Google's token endpoint. Returns [httpStatus, decodedBody].
 * Fails the request (502) on transport-level errors.
 */
function googleTokenRequest(array $fields): array
{
    $body = http_build_query($fields);

    if (function_exists('curl_init')) {
        $ch = curl_init(GOOGLE_TOKEN_URL);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 20,
        ]);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($raw === false) {
            fail(502, 'upstream_unreachable', 'Could not reach Google token endpoint');
        }
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
                'content' => $body,
                'timeout' => 20,
                'ignore_errors' => true, // still read the body on 4xx/5xx
            ],
        ]);
        $raw = @file_get_contents(GOOGLE_TOKEN_URL, false, $context);
        if ($raw === false) {
            fail(502, 'upstream_unreachable', 'Could not reach Google token endpoint');
        }
        $status = 0;
        foreach ($http_response_header ?? [] as $headerLine) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $headerLine, $m)) {
                $status = (int) $m[1]; // last status line wins (follows redirects)
            }
        }
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        fail(502, 'upstream_invalid', 'Google returned a non-JSON response');
    }
    return [$status, $decoded];
}

/* ── CORS ────────────────────────────────────────────────────────────────── */

function applyCors(?array $config): void
{
    header('Vary: Origin');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '' || $config === null) {
        return;
    }
    if (in_array($origin, $config['allowed_origins'], true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
        header('Access-Control-Max-Age: 86400');
    }
}

/* ── Request dispatch ────────────────────────────────────────────────────── */

[$config, $configError] = tryLoadConfig();
applyCors($config);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$action = $_POST['action'] ?? ($_GET['action'] ?? '');

if ($method === 'GET') {
    if ($action === 'health') {
        respond(200, [
            'status' => 'ok',
            'config' => $config !== null,
            'config_error' => $config === null ? $configError : null,
            'crypto' => sodiumAeadAvailable() ? 'sodium-xchacha20poly1305' : 'openssl-aes-256-gcm',
        ]);
    }
    fail(405, 'method_not_allowed', 'POST with action=exchange|refresh, or GET ?action=health');
}

if ($method !== 'POST') {
    fail(405, 'method_not_allowed');
}

if ($config === null) {
    fail(500, $configError, 'Broker is not configured on this server');
}

switch ($action) {
    case 'exchange': {
        $code = $_POST['code'] ?? '';
        if (!is_string($code) || $code === '') {
            fail(400, 'missing_code');
        }
        // 'postmessage' is the fixed redirect_uri Google expects for codes
        // issued by the GIS JavaScript popup code client.
        $redirectUri = $_POST['redirect_uri'] ?? 'postmessage';

        [$status, $resp] = googleTokenRequest([
            'grant_type' => 'authorization_code',
            'code' => $code,
            'client_id' => $config['google_client_id'],
            'client_secret' => $config['google_client_secret'],
            'redirect_uri' => $redirectUri,
        ]);

        if ($status !== 200 || empty($resp['access_token'])) {
            $googleError = is_string($resp['error'] ?? null) ? $resp['error'] : 'exchange_failed';
            fail($googleError === 'invalid_grant' ? 401 : 502, $googleError,
                is_string($resp['error_description'] ?? null) ? $resp['error_description'] : '');
        }

        $out = [
            'access_token' => $resp['access_token'],
            'expires_in' => (int) ($resp['expires_in'] ?? 3600),
        ];
        // Google only returns a refresh token on a consenting grant; pass it
        // through encrypted when present, omit it otherwise so the client
        // keeps whatever blob it already has.
        if (!empty($resp['refresh_token']) && is_string($resp['refresh_token'])) {
            $out['encrypted_refresh_token'] = encryptRefreshToken($resp['refresh_token'], $config['encryption_key']);
        }
        respond(200, $out);
    }

    case 'refresh': {
        $blob = $_POST['encrypted_refresh_token'] ?? '';
        if (!is_string($blob) || $blob === '') {
            fail(400, 'missing_encrypted_refresh_token');
        }
        $refreshToken = decryptRefreshToken($blob, $config['encryption_key']);
        if ($refreshToken === null) {
            fail(400, 'invalid_payload', 'Encrypted refresh token could not be decrypted');
        }

        [$status, $resp] = googleTokenRequest([
            'grant_type' => 'refresh_token',
            'refresh_token' => $refreshToken,
            'client_id' => $config['google_client_id'],
            'client_secret' => $config['google_client_secret'],
        ]);

        // Best-effort scrub of the plaintext refresh token from memory before
        // building the response. (PHP frees everything at request end anyway.)
        if (function_exists('sodium_memzero')) {
            sodium_memzero($refreshToken);
        }

        if ($status !== 200 || empty($resp['access_token'])) {
            $googleError = is_string($resp['error'] ?? null) ? $resp['error'] : 'refresh_failed';
            fail($googleError === 'invalid_grant' ? 401 : 502, $googleError,
                is_string($resp['error_description'] ?? null) ? $resp['error_description'] : '');
        }

        respond(200, [
            'access_token' => $resp['access_token'],
            'expires_in' => (int) ($resp['expires_in'] ?? 3600),
        ]);
    }

    default:
        fail(400, 'unknown_action', "Expected action=exchange or action=refresh");
}
