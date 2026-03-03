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

function stableStringify(value){
  if(value === null) return 'null';
  const t = typeof value;
  if(t === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if(t === 'boolean') return value ? 'true' : 'false';
  if(t === 'string') return JSON.stringify(value);
  if(Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if(t === 'object'){
    const keys = Object.keys(value).sort();
    const items = [];
    for(const key of keys){
      const v = value[key];
      if(typeof v === 'undefined') continue;
      items.push(JSON.stringify(key) + ':' + stableStringify(v));
    }
    return '{' + items.join(',') + '}';
  }
  return 'null';
}

function resolveAssetUrl(owner, repo, tag, row){
  const assetName = String(row.assetName || path.basename(String(row.file || ''))).trim();
  if(!assetName) throw new Error('missing assetName/file');
  return `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
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
    url: resolveAssetUrl(owner, repo, tag, row),
    sha256: hash,
    exports: exportsList,
    license: String(row.license || ''),
    upstream: row.upstream && typeof row.upstream === 'object' ? row.upstream : {}
  };
}

function buildSigningPayload(manifest){
  const payload = {
    version: String(manifest.version || ''),
    channel: String(manifest.channel || ''),
    generatedAt: String(manifest.generatedAt || ''),
    engines: manifest.engines && typeof manifest.engines === 'object' ? manifest.engines : {},
    datasets: manifest.datasets && typeof manifest.datasets === 'object' ? manifest.datasets : {}
  };
  return stableStringify(payload);
}

function resolvePrivateKey(){
  const pemRaw = String(process.env.FTSP_RUNTIME_SIGNING_PRIVATE_KEY || '').trim();
  if(pemRaw){
    const pem = pemRaw.includes('BEGIN') ? pemRaw.replace(/\\n/g, '\n') : '';
    if(pem){
      return crypto.createPrivateKey({ key: pem, format: 'pem' });
    }
  }

  const b64 = String(process.env.FTSP_RUNTIME_SIGNING_PRIVATE_KEY_B64 || '').trim();
  if(b64){
    const der = Buffer.from(b64, 'base64');
    if(der.length){
      return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    }
  }

  return null;
}

function signManifest(manifest, sources){
  const payloadText = buildSigningPayload(manifest);
  const payloadBytes = Buffer.from(payloadText, 'utf8');
  const payloadHash = sha256Hex(payloadBytes);
  const privateKey = resolvePrivateKey();
  const signing = sources.signing && typeof sources.signing === 'object' ? sources.signing : {};

  if(privateKey){
    const keyId = String(signing.keyId || 'ftsp_runtime_registry_ed25519_v1');
    const signature = crypto.sign(null, payloadBytes, privateKey);
    manifest.signature = {
      alg: 'ed25519',
      keyId: keyId,
      value: signature.toString('base64'),
      signedPayloadSha256: payloadHash
    };
    return {
      signatureAlg: 'ed25519',
      keyId: keyId,
      signedPayloadSha256: payloadHash,
      signature: signature.toString('base64')
    };
  }

  manifest.signature = {
    alg: 'sha256-sidecar',
    keyId: 'manifest_sha256',
    value: '',
    signedPayloadSha256: payloadHash
  };
  return {
    signatureAlg: 'sha256-sidecar',
    keyId: 'manifest_sha256',
    signedPayloadSha256: payloadHash,
    signature: ''
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
    version: String(tag).replace(/^v/, ''),
    channel: String(channel || sources.channel || 'stable'),
    generatedAt: new Date().toISOString(),
    signature: {
      alg: 'sha256-sidecar',
      keyId: 'manifest_sha256',
      value: '',
      signedPayloadSha256: ''
    },
    engines,
    datasets
  };

  const signed = signManifest(manifest, sources);
  const finalJson = JSON.stringify(manifest, null, 2) + '\n';
  const manifestHash = sha256Hex(Buffer.from(finalJson, 'utf8'));
  return { manifest, finalJson, manifestHash, signed };
}

function sidecarDoc(manifestFileName, manifestHash, signed){
  return {
    alg: String(signed.signatureAlg || 'sha256-sidecar'),
    keyId: String(signed.keyId || (signed.signatureAlg === 'ed25519' ? 'ftsp_runtime_registry_ed25519_v1' : 'manifest_sha256')),
    manifest: manifestFileName,
    sha256: manifestHash,
    signedPayloadSha256: String(signed.signedPayloadSha256 || ''),
    signature: String(signed.signature || ''),
    generatedAt: new Date().toISOString()
  };
}

function writeArtifacts(channel, finalJson, manifestHash, signed){
  const outDir = path.resolve(process.cwd(), 'manifests');
  fs.mkdirSync(outDir, { recursive: true });
  const channelFile = path.join(outDir, `runtime-index.${channel}.json`);
  const defaultFile = path.join(outDir, 'runtime-index.json');
  const channelSigFile = path.join(outDir, `runtime-index.${channel}.sig`);

  fs.writeFileSync(channelFile, finalJson, 'utf8');
  fs.writeFileSync(channelSigFile, JSON.stringify(sidecarDoc(`runtime-index.${channel}.json`, manifestHash, signed), null, 2) + '\n', 'utf8');

  if(channel === 'stable'){
    fs.writeFileSync(defaultFile, finalJson, 'utf8');
    fs.writeFileSync(path.join(outDir, 'runtime-index.sig'), JSON.stringify(sidecarDoc('runtime-index.json', manifestHash, signed), null, 2) + '\n', 'utf8');
  }
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
    const { finalJson, manifestHash, signed } = buildManifest(sources, ch);
    writeArtifacts(ch, finalJson, manifestHash, signed);
    console.log(`Built manifests/runtime-index.${ch}.json sha256=${manifestHash} signature=${signed.signatureAlg}`);
  }
}

main();
