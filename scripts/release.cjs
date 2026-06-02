#!/usr/bin/env node
/**
 * Release script: loads GH_TOKEN from .env, then builds + publishes
 * to GitHub Releases via electron-builder.
 *
 * Usage: npm run release
 */
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

if (!process.env.GH_TOKEN) {
  console.error('[release] GH_TOKEN not found in environment or .env');
  console.error('[release] Create .env with: GH_TOKEN=ghp_xxxxxxxxxxxx');
  process.exit(1);
}

console.log('[release] GH_TOKEN loaded (length:', process.env.GH_TOKEN.length, ')');

const steps = [
  { cmd: 'npm', args: ['run', 'build'], label: 'build' },
  {
    cmd: 'npx',
    args: ['electron-builder', '--win', '--publish', 'always'],
    label: 'electron-builder publish',
  },
];

for (const step of steps) {
  console.log(`\n[release] === ${step.label} ===`);
  const result = spawnSync(step.cmd, step.args, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`[release] ${step.label} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n[release] Done. Check https://github.com/Seo-jc/company-meeting/releases');
