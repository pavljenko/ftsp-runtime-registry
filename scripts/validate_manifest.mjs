#!/usr/bin/env node
import fs from 'node:fs';

const ALLOWED_LICENSES = new Set([
  'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC', 'BSL-1.0', 'OFL-1.1', 'FTL', 'Unicode-DFS-2016'
]);

function fail(message){
  console.error(`Manifest validation failed: ${message}`);
  process.exit(1);
}

function validateUrl(url){
  const s = String(url || '');
  if(!s.startsWith('https://')) return false;
  if(s.includes('/latest/')) return false;
  if(s.includes('/main/')) return false;
  return true;
}

function validateEntry(kind, row){
  if(!row || typeof row !== 'object') fail(`${kind}: missing row`);
  if(!String(row.version || '').trim()) fail(`${kind}: missing version`);
  if(!validateUrl(row.url)) fail(`${kind}: url must be pinned and https`);
  const sha = String(row.sha256 || '').trim().toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(sha)) fail(`${kind}: invalid sha256`);
  if(!ALLOWED_LICENSES.has(String(row.license || ''))) fail(`${kind}: disallowed license ${String(row.license || '')}`);
}

const manifestPath = process.argv[2] || 'manifests/runtime-index.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if(!String(manifest.version || '').trim()) fail('missing version');
if(!String(manifest.channel || '').trim()) fail('missing channel');
if(!String(manifest.generatedAt || '').trim()) fail('missing generatedAt');

for(const [k, v] of Object.entries(manifest.engines || {})) validateEntry(`engine:${k}`, v);
for(const [k, v] of Object.entries(manifest.datasets || {})) validateEntry(`dataset:${k}`, v);

const sig = manifest.signature && typeof manifest.signature === 'object' ? manifest.signature : null;
if(!sig || !String(sig.value || '').trim()) fail('missing signature.value');
console.log(`Manifest validation passed: ${manifestPath}`);
