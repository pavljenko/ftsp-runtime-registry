#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ALLOWED = new Set([
  'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC', 'BSL-1.0', 'OFL-1.1', 'FTL', 'Unicode-DFS-2016'
]);

function listManifestFiles(root){
  const out = [];
  if(!fs.existsSync(root)) return out;
  for(const name of fs.readdirSync(root)){
    if(!/^runtime-index(\.[a-z0-9_-]+)?\.json$/i.test(name)) continue;
    out.push(path.join(root, name));
  }
  return out.sort();
}

function gateManifest(filePath){
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const problems = [];
  for(const [kind, row] of Object.entries(manifest.engines || {})){
    const lic = String(row && row.license || '');
    if(!ALLOWED.has(lic)) problems.push(`${filePath}: engine:${kind} license=${lic}`);
  }
  for(const [kind, row] of Object.entries(manifest.datasets || {})){
    const lic = String(row && row.license || '');
    if(!ALLOWED.has(lic)) problems.push(`${filePath}: dataset:${kind} license=${lic}`);
  }
  return problems;
}

const target = process.argv[2] || 'manifests';
const files = fs.statSync(target).isDirectory() ? listManifestFiles(target) : [target];
if(!files.length){
  console.error('License gate failed: no manifest files found');
  process.exit(1);
}

const issues = [];
for(const file of files){
  issues.push(...gateManifest(file));
}

if(issues.length){
  console.error('License gate failed:');
  for(const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}
console.log(`License gate passed for ${files.length} manifest(s)`);
