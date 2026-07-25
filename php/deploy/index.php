<?php
/**
 * Brainboard Deployment Script
 * Pulls a build from GitHub Releases and extracts it over an existing site.
 *
 * Serves two environments from one script + one config.php:
 *   - prod (default): fetches /releases/latest, uses DEPLOY_SECRET / DEPLOY_TARGET
 *   - dev (?env=dev): fetches a fixed release tag (DEPLOY_RELEASE_TAG_DEV, default
 *     "dev") so it never picks up whatever real version tag prod last released,
 *     uses DEPLOY_SECRET_DEV / DEPLOY_TARGET_DEV
 */

// --- CONFIGURATION ---
if (file_exists(__DIR__ . '/config.php')) {
    include __DIR__ . '/config.php';
}

$repo_owner = 'MinimalHumans';
$repo_name = 'SCF_brainboard';

$env = (isset($_GET['env']) && $_GET['env'] === 'dev') ? 'dev' : 'prod';

if ($env === 'dev') {
    $secret_token = defined('DEPLOY_SECRET_DEV') ? DEPLOY_SECRET_DEV : null;
    $target_dir = defined('DEPLOY_TARGET_DEV') ? DEPLOY_TARGET_DEV : null;
    $release_tag = defined('DEPLOY_RELEASE_TAG_DEV') ? DEPLOY_RELEASE_TAG_DEV : 'dev';
} else {
    // Fallback or default configuration
    $secret_token = defined('DEPLOY_SECRET') ? DEPLOY_SECRET : 'CHANGE_ME_IN_CONFIG_PHP';
    // Target directory for extraction
    // If this script is at <root>/php/deploy/index.php, then /../../ is the <root>
    $target_dir = defined('DEPLOY_TARGET') ? DEPLOY_TARGET : __DIR__ . '/../../';
    $release_tag = null; // null => use /releases/latest
}

if (empty($secret_token) || empty($target_dir)) {
    header('HTTP/1.1 500 Internal Server Error');
    die("Deploy environment '$env' is not configured");
}

// --- AUTHENTICATION ---
// Read via $_SERVER, not getallheaders(): a proxy in front of this host lowercases
// the header on the wire, and getallheaders() array keys are case-sensitive, so
// $headers['X-Deploy-Token'] silently misses it. $_SERVER always normalizes to
// HTTP_X_DEPLOY_TOKEN regardless of wire case.
$received_token = isset($_SERVER['HTTP_X_DEPLOY_TOKEN']) ? $_SERVER['HTTP_X_DEPLOY_TOKEN'] : (isset($_GET['token']) ? $_GET['token'] : '');

if (empty($received_token) || !hash_equals($secret_token, $received_token)) {
    header('HTTP/1.1 401 Unauthorized');
    die('Unauthorized');
}

// --- FETCH RELEASE ---
$api_url = $release_tag !== null
    ? "https://api.github.com/repos/$repo_owner/$repo_name/releases/tags/$release_tag"
    : "https://api.github.com/repos/$repo_owner/$repo_name/releases/latest";
$options = [
    'http' => [
        'method' => 'GET',
        'header' => [
            'User-Agent: PHP-Deploy-Script'
        ]
    ]
];
$context = stream_context_create($options);
$response = file_get_contents($api_url, false, $context);

if ($response === false) {
    die('Failed to fetch release info from GitHub');
}

$release = json_decode($response, true);
$zip_url = '';

// Find the dist.zip asset
foreach ($release['assets'] as $asset) {
    if ($asset['name'] === 'dist.zip') {
        $zip_url = $asset['browser_download_url'];
        break;
    }
}

if (empty($zip_url)) {
    die('Could not find dist.zip in the latest release');
}

// --- DOWNLOAD AND EXTRACT ---
$tmp_zip = __DIR__ . '/dist.zip';
if (!copy($zip_url, $tmp_zip)) {
    die('Failed to download release asset');
}

$zip = new ZipArchive;
if ($zip->open($tmp_zip) === TRUE) {
    // Extract to target directory
    $zip->extractTo($target_dir);
    $zip->close();
    unlink($tmp_zip);
    echo "Successfully deployed version " . $release['tag_name'] . " ($env)";
} else {
    unlink($tmp_zip);
    die('Failed to open zip archive');
}
