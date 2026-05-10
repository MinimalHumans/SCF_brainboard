<?php
/**
 * Brainboard Deployment Script
 * This script pulls the latest build from GitHub Releases.
 */

// --- CONFIGURATION ---
if (file_exists(__DIR__ . '/config.php')) {
    include __DIR__ . '/config.php';
}

// Fallback or default configuration
$secret_token = defined('DEPLOY_SECRET') ? DEPLOY_SECRET : 'CHANGE_ME_IN_CONFIG_PHP';
$repo_owner = 'MinimalHumans';
$repo_name = 'SCF_brainboard';

// Target directory for extraction
// If this script is at <root>/php/deploy/index.php, then /../../ is the <root>
$target_dir = defined('DEPLOY_TARGET') ? DEPLOY_TARGET : __DIR__ . '/../../';

// --- AUTHENTICATION ---
$headers = getallheaders();
$received_token = isset($headers['X-Deploy-Token']) ? $headers['X-Deploy-Token'] : (isset($_GET['token']) ? $_GET['token'] : '');

if (empty($received_token) || $received_token !== $secret_token) {
    header('HTTP/1.1 401 Unauthorized');
    die('Unauthorized');
}

// --- FETCH LATEST RELEASE ---
$api_url = "https://api.github.com/repos/$repo_owner/$repo_name/releases/latest";
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
    echo "Successfully deployed version " . $release['tag_name'];
} else {
    unlink($tmp_zip);
    die('Failed to open zip archive');
}
