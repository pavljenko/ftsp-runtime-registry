#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const STRICT_FETCH = process.argv.includes('--strict-fetch');

function readJson(filePath){
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(filePath){
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function fetchBuffer(url){
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'ftsp-runtime-registry-bot',
      'Accept': '*/*'
    }
  });
  if(!res.ok){
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function fetchText(url){
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'ftsp-runtime-registry-bot',
      'Accept': 'text/plain,application/json,*/*'
    }
  });
  if(!res.ok){
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return await res.text();
}

function validateWasm(filePath){
  const buf = fs.readFileSync(filePath);
  if(buf.length < 8) throw new Error(`${filePath}: wasm is too small`);
  if(buf[0] !== 0x00 || buf[1] !== 0x61 || buf[2] !== 0x73 || buf[3] !== 0x6d){
    throw new Error(`${filePath}: invalid wasm magic`);
  }
}

function parseHexCodepoint(token){
  const t = String(token || '').trim().toUpperCase();
  if(!/^[0-9A-F]{2,6}$/.test(t)) return null;
  const cp = Number.parseInt(t, 16);
  if(!Number.isFinite(cp) || cp <= 0 || cp > 0x10FFFF) return null;
  return cp;
}

function parseUts39Pairs(rawText){
  const pairs = [];
  const lines = String(rawText || '').split(/\r?\n/);
  for(const line of lines){
    const body = String(line || '').replace(/#.*/, '').trim();
    if(!body) continue;
    const cols = body.split(';').map(v => v.trim());
    if(cols.length < 2) continue;
    const srcTokens = cols[0].split(/\s+/).filter(Boolean);
    const dstTokens = cols[1].split(/\s+/).filter(Boolean);
    if(srcTokens.length !== 1 || dstTokens.length !== 1) continue;
    const source = parseHexCodepoint(srcTokens[0]);
    const target = parseHexCodepoint(dstTokens[0]);
    if(!source || !target) continue;
    pairs.push({
      source,
      target,
      class: 'moderate',
      label: `U+${source.toString(16).toUpperCase()}~U+${target.toString(16).toUpperCase()}`
    });
  }
  return pairs;
}

async function buildRemoteAsset(row, kindLabel){
  const src = row && row.source ? row.source : {};
  const file = String(row && row.file || '').trim();
  const url = String(src && src.url || '').trim();
  if(!file) throw new Error(`${kindLabel}: missing file`);
  if(!url) throw new Error(`${kindLabel}: missing source.url`);
  const abs = path.resolve(process.cwd(), file);
  ensureDir(abs);
  try{
    const bytes = await fetchBuffer(url);
    fs.writeFileSync(abs, bytes);
    validateWasm(abs);
    return { file, bytes: bytes.length, source: url, reused: false };
  }catch(err){
    if(!STRICT_FETCH && fs.existsSync(abs)){
      validateWasm(abs);
      const existing = fs.readFileSync(abs);
      return {
        file,
        bytes: existing.length,
        source: url,
        reused: true,
        note: `fetch failed, reused local asset: ${String(err && err.message || err)}`
      };
    }
    throw err;
  }
}

async function buildUts39Dataset(row, kindLabel){
  const src = row && row.source ? row.source : {};
  const file = String(row && row.file || '').trim();
  const url = String(src && src.url || '').trim();
  if(!file) throw new Error(`${kindLabel}: missing file`);
  if(!url) throw new Error(`${kindLabel}: missing source.url`);
  const abs = path.resolve(process.cwd(), file);
  ensureDir(abs);
  try{
    const raw = await fetchText(url);
    const pairs = parseUts39Pairs(raw);
    const payload = {
      version: String(row && row.version || ''),
      generatedAt: new Date().toISOString(),
      source: url,
      pairs
    };
    const json = Buffer.from(JSON.stringify(payload, null, 2) + '\n', 'utf8');
    const gz = zlib.gzipSync(json, { level: 9 });
    fs.writeFileSync(abs, gz);
    return { file, bytes: gz.length, source: url, pairs: pairs.length, reused: false };
  }catch(err){
    if(!STRICT_FETCH && fs.existsSync(abs)){
      const existing = fs.readFileSync(abs);
      return {
        file,
        bytes: existing.length,
        source: url,
        reused: true,
        note: `fetch failed, reused local dataset: ${String(err && err.message || err)}`
      };
    }
    throw err;
  }
}

async function main(){
  const srcPath = process.argv[2] || 'manifests/runtime-sources.json';
  const src = readJson(srcPath);
  const report = {
    builtAt: new Date().toISOString(),
    engines: {},
    datasets: {}
  };

  for(const [kind, row] of Object.entries(src.engines || {})){
    const type = String(row && row.source && row.source.type || '').trim();
    if(type === 'remote-url'){
      report.engines[kind] = await buildRemoteAsset(row, `engine:${kind}`);
    }else{
      throw new Error(`engine:${kind}: unsupported source.type '${type}'`);
    }
  }

  for(const [kind, row] of Object.entries(src.datasets || {})){
    const type = String(row && row.source && row.source.type || '').trim();
    if(type === 'uts39-generate'){
      report.datasets[kind] = await buildUts39Dataset(row, `dataset:${kind}`);
    }else if(type === 'remote-url'){
      report.datasets[kind] = await (async () => {
        const built = await buildRemoteAsset(row, `dataset:${kind}`);
        return built;
      })();
    }else{
      throw new Error(`dataset:${kind}: unsupported source.type '${type}'`);
    }
  }

  fs.mkdirSync(path.resolve(process.cwd(), 'manifests'), { recursive: true });
  fs.writeFileSync(path.resolve(process.cwd(), 'manifests/assets-build-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`Assets built: engines=${Object.keys(report.engines).length}, datasets=${Object.keys(report.datasets).length}`);
}

main().catch((err) => {
  console.error(String(err && err.stack || err));
  process.exit(1);
});
