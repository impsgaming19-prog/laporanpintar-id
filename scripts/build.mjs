#!/usr/bin/env node
import { execSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Add node_modules/.bin to PATH
const binDir = resolve(projectRoot, 'node_modules/.bin');
process.env.PATH = `${binDir}:${process.env.PATH}`;

try {
  execSync('vite build', { 
    cwd: projectRoot, 
    stdio: 'inherit',
    env: process.env
  });
} catch (e) {
  process.exit(e.status || 1);
}
