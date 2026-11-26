#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLOUDFLARED_VERSION = process.env.ANCHOR_CLOUDFLARED_VERSION || '2026.11.2';
const BASE_URL = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const BINARIES_DIR = path.join(ROOT_DIR, 'src-tauri', 'binaries');

const TARGET_SPECS = {
  'aarch64-apple-darwin': {
    asset: 'cloudflared-darwin-arm64.tgz',
    archive: 'tgz',
    output: 'cloudflared-aarch64-apple-darwin',
    executable: true,
  },
  'x86_64-apple-darwin': {
    asset: 'cloudflared-darwin-amd64.tgz',
    archive: 'tgz',
    output: 'cloudflared-x86_64-apple-darwin',
    executable: true,
  },
  'x86_64-pc-windows-msvc': {
    asset: 'cloudflared-windows-amd64.exe',
    archive: 'raw',
    output: 'cloudflared-x86_64-pc-windows-msvc.exe',
    executable: false,
  },
};

function parsePlatformArg() {
  const arg = process.argv.find((a) => a.startsWith('--platform='));
  return arg ? arg.slice('--platform='.length).trim() : 'current';
}

function resolveTargets(platformMode) {
  if (platformMode === 'macos-universal') {
    return ['aarch64-apple-darwin', 'x86_64-apple-darwin'];
  }
  if (platformMode === 'windows-x64') {
    return ['x86_64-pc-windows-msvc'];
  }
  if (platformMode === 'all') {
    return Object.keys(TARGET_SPECS);
  }
  // 'current'
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? ['aarch64-apple-darwin'] : ['x86_64-apple-darwin'];
  }
  if (process.platform === 'win32') {
    return ['x86_64-pc-windows-msvc'];
  }
  console.log(`[prepare-cloudflared] Skipping unsupported host platform: ${process.platform}/${process.arch}`);
  return [];
}

async function downloadFile(url, destPath) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Anchor-Build/1.0' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} while downloading ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024 * 1024) {
    throw new Error(`Downloaded file looks unexpectedly small (${buf.length} bytes): ${url}`);
  }
  fs.writeFileSync(destPath, buf);
}

async function prepareTarget(triple, force) {
  const spec = TARGET_SPECS[triple];
  if (!spec) {
    throw new Error(`Unknown target triple: ${triple}`);
  }

  fs.mkdirSync(BINARIES_DIR, { recursive: true });
  const outputPath = path.join(BINARIES_DIR, spec.output);

  if (!force && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024 * 1024) {
    console.log(`[prepare-cloudflared] Cached: ${path.relative(ROOT_DIR, outputPath)}`);
    if (spec.executable && process.platform !== 'win32') {
      fs.chmodSync(outputPath, 0o755);
    }
    return;
  }

  const url = `${BASE_URL}/${spec.asset}`;
  console.log(`[prepare-cloudflared] Downloading ${spec.asset} (${CLOUDFLARED_VERSION}) -> ${spec.output} ...`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-cloudflared-'));
  try {
    const dlPath = path.join(tmpDir, spec.asset);
    await downloadFile(url, dlPath);

    if (spec.archive === 'tgz') {
      execFileSync('tar', ['-xzf', dlPath, '-C', tmpDir], { stdio: 'inherit' });
      const extracted = path.join(tmpDir, 'cloudflared');
      if (!fs.existsSync(extracted)) {
        throw new Error(`Extracted archive did not contain 'cloudflared' binary`);
      }
      fs.copyFileSync(extracted, outputPath);
    } else {
      fs.copyFileSync(dlPath, outputPath);
    }

    if (spec.executable && process.platform !== 'win32') {
      fs.chmodSync(outputPath, 0o755);
    }

    const sizeMb = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(1);
    console.log(`[prepare-cloudflared] Ready: ${path.relative(ROOT_DIR, outputPath)} (${sizeMb} MB)`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function prepareMacosUniversalFatBinary(force) {
  if (process.platform !== 'darwin') {
    console.log('[prepare-cloudflared] Skipping lipo universal merge on non-macOS host');
    return;
  }
  const armPath = path.join(BINARIES_DIR, TARGET_SPECS['aarch64-apple-darwin'].output);
  const x64Path = path.join(BINARIES_DIR, TARGET_SPECS['x86_64-apple-darwin'].output);
  const universalPath = path.join(BINARIES_DIR, 'cloudflared-universal-apple-darwin');

  if (!fs.existsSync(armPath) || !fs.existsSync(x64Path)) {
    throw new Error('Cannot create universal binary: arm64 or x86_64 cloudflared binary is missing');
  }

  if (!force && fs.existsSync(universalPath) && fs.statSync(universalPath).size > 2 * 1024 * 1024) {
    fs.chmodSync(universalPath, 0o755);
    console.log(`[prepare-cloudflared] Cached: ${path.relative(ROOT_DIR, universalPath)}`);
    return;
  }

  console.log('[prepare-cloudflared] Merging arm64 + x86_64 via lipo -> cloudflared-universal-apple-darwin ...');
  execFileSync('lipo', ['-create', '-output', universalPath, armPath, x64Path], {
    stdio: 'inherit',
  });
  fs.chmodSync(universalPath, 0o755);
  const sizeMb = (fs.statSync(universalPath).size / (1024 * 1024)).toFixed(1);
  console.log(`[prepare-cloudflared] Ready: ${path.relative(ROOT_DIR, universalPath)} (${sizeMb} MB)`);
}

async function main() {
  const platformMode = parsePlatformArg();
  const force = process.argv.includes('--force');
  const targets = resolveTargets(platformMode);
  for (const triple of targets) {
    await prepareTarget(triple, force);
  }
  if (platformMode === 'macos-universal' || platformMode === 'all') {
    prepareMacosUniversalFatBinary(force);
  }
}

main().catch((err) => {
  console.error('[prepare-cloudflared] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
