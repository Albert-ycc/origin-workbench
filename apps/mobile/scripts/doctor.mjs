#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, '..');
const repoRoot = path.resolve(mobileRoot, '..', '..');

const checks = [
  {
    label: 'mobile package',
    path: path.join(mobileRoot, 'package.json'),
  },
  {
    label: 'mobile HTML entry',
    path: path.join(mobileRoot, 'index.html'),
  },
  {
    label: 'mobile manifest',
    path: path.join(mobileRoot, 'public', 'manifest.webmanifest'),
  },
  {
    label: 'regular icon placeholder',
    path: path.join(mobileRoot, 'public', 'icons', 'icon.svg'),
  },
  {
    label: 'maskable icon placeholder',
    path: path.join(mobileRoot, 'public', 'icons', 'icon-maskable.svg'),
  },
  {
    label: 'Capacitor config',
    path: path.join(mobileRoot, 'capacitor.config.ts'),
  },
];

let failures = 0;

for (const check of checks) {
  try {
    await access(check.path, constants.R_OK);
    console.log(`ok - ${check.label}`);
  } catch {
    failures += 1;
    console.error(`missing - ${check.label}: ${path.relative(repoRoot, check.path)}`);
  }
}

try {
  const workspace = await readFile(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  if (workspace.includes('"apps/mobile"') || workspace.includes("'apps/mobile'") || workspace.includes('apps/mobile')) {
    console.log('ok - apps/mobile is listed in pnpm-workspace.yaml');
  } else {
    console.warn('todo - apps/mobile is not listed in pnpm-workspace.yaml yet');
  }
} catch {
  console.warn('todo - could not read pnpm-workspace.yaml');
}

try {
  const html = await readFile(path.join(mobileRoot, 'index.html'), 'utf8');
  if (html.includes('rel="manifest"') && html.includes('/manifest.webmanifest')) {
    console.log('ok - manifest is linked from index.html');
  } else {
    failures += 1;
    console.error('missing - manifest link in apps/mobile/index.html');
  }
} catch {
  failures += 1;
  console.error('missing - apps/mobile/index.html');
}

try {
  const packageJson = JSON.parse(await readFile(path.join(mobileRoot, 'package.json'), 'utf8'));
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  for (const dependency of ['@capacitor/core', '@capacitor/cli', '@capacitor/ios']) {
    if (deps[dependency]) {
      console.log(`ok - ${dependency} is declared`);
    } else {
      failures += 1;
      console.error(`missing - ${dependency} dependency`);
    }
  }
} catch {
  failures += 1;
  console.error('missing - readable apps/mobile/package.json');
}

if (failures > 0) {
  process.exitCode = 1;
}
