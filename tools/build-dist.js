const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function buildDist() {
  const rootDir = path.resolve(__dirname, '..');
  const extensionDir = path.join(rootDir, 'extension');
  const distDir = path.join(rootDir, 'dist');
  const manifestPath = path.join(extensionDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found at ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = manifest.version;
  console.log(`Building release package for ${manifest.name} v${version}...`);

  // Required files to include
  const expectedFiles = [
    'manifest.json',
    'background.js',
    'bridge.js',
    'guard.js',
    'stream-observer.js',
    'control.js',
    'popup.html',
    'popup.js',
    'icons/icon-16.png',
    'icons/icon-32.png',
    'icons/icon-48.png',
    'icons/icon-128.png'
  ];

  for (const relPath of expectedFiles) {
    const fullPath = path.join(extensionDir, relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Required extension file missing: ${relPath}`);
    }
  }

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const zipFilename = `chatgpt-conversation-availability-guard-v${version}.zip`;
  const zipPath = path.join(distDir, zipFilename);

  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  const packScript = path.join(__dirname, 'pack-zip.py');
  execFileSync('python', [packScript, zipPath, extensionDir, ...expectedFiles], {
    stdio: 'inherit'
  });

  if (!fs.existsSync(zipPath)) {
    throw new Error(`Zip package was not created at ${zipPath}`);
  }

  const fileBuffer = fs.readFileSync(zipPath);
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  const sizeBytes = fileBuffer.length;

  const sha256Filename = `chatgpt-conversation-availability-guard-v${version}.sha256.txt`;
  const sha256Path = path.join(distDir, sha256Filename);
  fs.writeFileSync(sha256Path, `${sha256}  ${zipFilename}\n`, 'utf8');

  console.log(`\n======================================================`);
  console.log(`PACKAGE BUILD SUCCESSFUL!`);
  console.log(`Package: ${zipFilename}`);
  console.log(`Path:    ${zipPath}`);
  console.log(`Size:    ${sizeBytes.toLocaleString()} bytes (${(sizeBytes / 1024).toFixed(1)} KB)`);
  console.log(`SHA-256: ${sha256}`);
  console.log(`Checksum:${sha256Filename}`);
  console.log(`======================================================\n`);

  console.log(`Included files (${expectedFiles.length}):`);
  for (const f of expectedFiles) {
    const stat = fs.statSync(path.join(extensionDir, f));
    console.log(`  - ${f.padEnd(24)} (${stat.size} bytes)`);
  }
}

try {
  buildDist();
} catch (err) {
  console.error('Build failed:', err);
  process.exit(1);
}
