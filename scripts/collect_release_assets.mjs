#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function readJson(filePath){
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function copyOne(src, dest){
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main(){
  const outDir = process.argv[2] || 'dist';
  const sources = readJson(path.resolve(process.cwd(), 'manifests/runtime-sources.json'));
  fs.mkdirSync(path.resolve(process.cwd(), outDir), { recursive: true });

  const copied = [];
  for(const row of Object.values(sources.engines || {})){
    const src = path.resolve(process.cwd(), String(row.file || ''));
    const name = String(row.assetName || path.basename(String(row.file || ''))).trim();
    const dst = path.resolve(process.cwd(), outDir, name);
    copyOne(src, dst);
    copied.push(dst);
  }
  for(const row of Object.values(sources.datasets || {})){
    const src = path.resolve(process.cwd(), String(row.file || ''));
    const name = String(row.assetName || path.basename(String(row.file || ''))).trim();
    const dst = path.resolve(process.cwd(), outDir, name);
    copyOne(src, dst);
    copied.push(dst);
  }

  const manifestFiles = [
    'runtime-index.json',
    'runtime-index.sig',
    'runtime-index.stable.json',
    'runtime-index.stable.sig',
    'runtime-index.candidate.json',
    'runtime-index.candidate.sig'
  ];
  for(const name of manifestFiles){
    const src = path.resolve(process.cwd(), 'manifests', name);
    const dst = path.resolve(process.cwd(), outDir, name);
    copyOne(src, dst);
    copied.push(dst);
  }

  console.log(JSON.stringify({ outDir, files: copied.map(v => path.basename(v)) }, null, 2));
}

main();
