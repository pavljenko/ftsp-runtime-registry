#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

function sha256Hex(buffer){
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readJson(filePath){
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fail(message){
  console.error(`Runtime smoke gate failed: ${message}`);
  process.exit(1);
}

async function validateWasm(filePath, kind){
  if(!fs.existsSync(filePath)) fail(`${kind}: missing file ${filePath}`);
  const bytes = fs.readFileSync(filePath);
  if(bytes.length < 8) fail(`${kind}: wasm too small`);
  if(bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d){
    fail(`${kind}: invalid wasm magic`);
  }
  try{
    await WebAssembly.compile(bytes);
  }catch(err){
    fail(`${kind}: wasm compile failed (${String(err && err.message || err)})`);
  }
}

function validateUts39(filePath){
  if(!fs.existsSync(filePath)) fail(`uts39: missing file ${filePath}`);
  const gz = fs.readFileSync(filePath);
  const json = zlib.gunzipSync(gz).toString('utf8');
  const parsed = JSON.parse(json);
  const pairs = Array.isArray(parsed && parsed.pairs) ? parsed.pairs : [];
  if(pairs.length < 1000){
    fail(`uts39: too few pairs (${pairs.length})`);
  }
}

function validateManifestHashes(manifestPath){
  const manifest = readJson(manifestPath);
  for(const [kind, row] of Object.entries(manifest.engines || {})){
    const sources = readJson(path.resolve(process.cwd(), 'manifests/runtime-sources.json'));
    const src = sources.engines && sources.engines[kind] ? sources.engines[kind] : null;
    if(!src) fail(`manifest:${kind}: source row missing`);
    const file = path.resolve(process.cwd(), String(src.file || ''));
    const bytes = fs.readFileSync(file);
    const sha = sha256Hex(bytes);
    if(String(row.sha256 || '').toLowerCase() !== sha){
      fail(`manifest:${kind}: sha mismatch`);
    }
  }
}

async function main(){
  const src = readJson(path.resolve(process.cwd(), 'manifests/runtime-sources.json'));
  for(const [kind, row] of Object.entries(src.engines || {})){
    await validateWasm(path.resolve(process.cwd(), String(row.file || '')), `engine:${kind}`);
  }

  for(const [kind, row] of Object.entries(src.datasets || {})){
    if(kind === 'uts39'){
      validateUts39(path.resolve(process.cwd(), String(row.file || '')));
    }
  }

  validateManifestHashes(path.resolve(process.cwd(), 'manifests/runtime-index.stable.json'));
  validateManifestHashes(path.resolve(process.cwd(), 'manifests/runtime-index.candidate.json'));
  console.log('Runtime smoke gate passed');
}

main().catch((err) => {
  console.error(String(err && err.stack || err));
  process.exit(1);
});
