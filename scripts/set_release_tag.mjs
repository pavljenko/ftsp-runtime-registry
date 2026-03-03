#!/usr/bin/env node
import fs from 'node:fs';

function pad2(v){
  return String(v).padStart(2, '0');
}

function defaultTag(){
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const run = String(process.env.GITHUB_RUN_NUMBER || '1').trim();
  return `v${y}.${m}.${day}.${run}`;
}

function main(){
  const file = process.argv[2] || 'manifests/runtime-sources.json';
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const explicit = String(process.env.FTSP_RELEASE_TAG || '').trim();
  data.releaseTag = explicit || defaultTag();
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`releaseTag=${data.releaseTag}`);
}

main();
