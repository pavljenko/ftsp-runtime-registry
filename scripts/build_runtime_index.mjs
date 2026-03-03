#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function readJson(filePath){
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256Hex(buffer){
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function resolveAssetUrl(owner, repo, tag, relPath){
  const fileName = path.basename(relPath);
  return `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`;
}

function resolveRow(rootDir, owner, repo, tag, kind, row){
  const relFile = String(row.file || '').trim();
  if(!relFile) throw new Error(`${kind}: missing file`);
  const absFile = path.resolve(rootDir, relFile);
  if(!fs.existsSync(absFile)) throw new Error(`${kind}: file not found ${relFile}`);
  const bytes = fs.readFileSync(absFile);
  const hash = sha256Hex(bytes);
  const exportsList = Array.isArray(row.exports) ? row.exports.map(v => String(v)) : [];
  return {
    version: String(row.version || ''),
    url: resolveAssetUrl(owner, repo, tag, relFile),
    sha256: hash,
    exports: exportsList,
    license: String(row.license || ''),
    upstream: row.upstream && typeof row.upstream === 'object' ? row.upstream : {}
  };
}

function buildManifest(sources, channel){
  const rootDir = process.cwd();
  const owner = String(sources.owner || 'pavljenko');
  const repo = String(sources.repo || 'ftsp-runtime-registry');
  const tag = String(sources.releaseTag || '').trim();
  if(!tag) throw new Error('releaseTag is required in manifests/runtime-sources.json');

  const engines = {};
  for(const [kind, row] of Object.entries(sources.engines || {})){
    engines[kind] = resolveRow(rootDir, owner, repo, tag, `engine:${kind}`, row || {});
  }

  const datasets = {};
  for(const [kind, row] of Object.entries(sources.datasets || {})){
    datasets[kind] = resolveRow(rootDir, owner, repo, tag, `dataset:${kind}`, row || {});
  }

  const manifest = {
    version: String(sources.releaseTag || '').replace(/^v/, ''),
    channel: String(channel || sources.channel || 'stable'),
    generatedAt: new Date().toISOString(),
    signature: {
      alg: 'sha256-sidecar',
      keyId: 'manifest_sha256',
      value: ''
    },
    engines,
    datasets
  };

  const normalized = JSON.stringify(manifest, null, 2) + '\n';
  const manifestHash = sha256Hex(Buffer.from(normalized, 'utf8'));
  manifest.signature.value = manifestHash;
  const finalJson = JSON.stringify(manifest, null, 2) + '\n';
  return { manifest, finalJson, manifestHash };
}

function writeArtifacts(channel, finalJson, manifestHash){
  const outDir = path.resolve(process.cwd(), 'manifests');
  fs.mkdirSync(outDir, { recursive: true });
  const channelFile = path.join(outDir, `runtime-index.${channel}.json`);
  const defaultFile = path.join(outDir, 'runtime-index.json');
  const sigFile = path.join(outDir, `runtime-index.${channel}.sig`);

  fs.writeFileSync(channelFile, finalJson, 'utf8');
  if(channel === 'stable'){
    fs.writeFileSync(defaultFile, finalJson, 'utf8');
    fs.writeFileSync(path.join(outDir, 'runtime-index.sig'), JSON.stringify({
      alg: 'sha256',
      keyId: 'manifest_sha256',
      manifest: 'runtime-index.json',
      sha256: manifestHash,
      generatedAt: new Date().toISOString()
    }, null, 2) + '\n', 'utf8');
  }

  fs.writeFileSync(sigFile, JSON.stringify({
    alg: 'sha256',
    keyId: 'manifest_sha256',
    manifest: `runtime-index.${channel}.json`,
    sha256: manifestHash,
    generatedAt: new Date().toISOString()
  }, null, 2) + '\n', 'utf8');
}

function main(){
  const channelsArg = process.argv.includes('--channels')
    ? process.argv[process.argv.indexOf('--channels') + 1]
    : 'stable,candidate';
  const channels = String(channelsArg || 'stable,candidate')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  if(!channels.length) throw new Error('no channels selected');

  const srcPath = path.resolve(process.cwd(), 'manifests/runtime-sources.json');
  const sources = readJson(srcPath);

  for(const ch of channels){
    const { finalJson, manifestHash } = buildManifest(sources, ch);
    writeArtifacts(ch, finalJson, manifestHash);
    console.log(`Built manifests/runtime-index.${ch}.json sha256=${manifestHash}`);
  }
}

main();
