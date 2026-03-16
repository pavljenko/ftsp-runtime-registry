#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

async function fetchJson(url){
  const res = await fetch(url, { headers: { 'User-Agent': 'ftsp-runtime-registry-bot' } });
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

async function fetchText(url){
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'ftsp-runtime-registry-bot',
      'Accept': 'text/plain,application/json,*/*'
    }
  });
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function sha256Hex(value){
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseGitHubRepo(url){
  const m = String(url || '').match(/github\.com\/([^\/]+)\/([^\/#]+)/i);
  if(!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
}

function normalizeVersionForPath(tag){
  const raw = String(tag || '').trim();
  if(!raw) return '';
  const semver = raw.replace(/^v/i, '');
  if(/^\d+(\.\d+){1,3}$/.test(semver)) return semver;
  return raw
    .replace(/^VER-/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function rewriteRemoteUrlVersion(url, oldVersion, newVersion){
  const src = String(url || '');
  if(!src) return src;
  const oldEsc = oldVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`@${oldEsc}/`);
  if(re.test(src)) return src.replace(re, `@${newVersion}/`);
  return src;
}

function rewriteVersionedPath(filePath, nextVersion){
  const src = String(filePath || '').replace(/\\/g, '/').trim();
  if(!src) return src;
  const parsed = path.posix.parse(src);
  const dir = parsed.dir.split('/');
  if(dir.length < 2) return src;
  dir[dir.length - 1] = nextVersion;
  return path.posix.join(dir.join('/'), parsed.base);
}

async function latestTagFromRepo(repoUrl, currentTag){
  const parsed = parseGitHubRepo(repoUrl);
  if(!parsed) return '';
  const tagUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/tags?per_page=100`;
  try{
    const tags = await fetchJson(tagUrl);
    const picked = pickTagByCurrentStyle(tags, currentTag);
    if(picked) return picked;
  }catch(_e){}
  const relUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases/latest`;
  try{
    const rel = await fetchJson(relUrl);
    if(rel && rel.tag_name) return String(rel.tag_name);
  }catch(_e){}
  return '';
}

function pickTagByCurrentStyle(tags, current){
  const rows = Array.isArray(tags) ? tags.map(t => String(t && t.name || '')).filter(Boolean) : [];
  if(!rows.length) return '';
  const cur = String(current || '').trim();
  const semverLike = v => /^v?\d+(\.\d+){1,3}([+-].*)?$/i.test(v);
  const compareTuple = (a, b) => {
    const len = Math.max(a.length, b.length);
    for(let i = 0; i < len; i++){
      const av = Number(a[i] || 0);
      const bv = Number(b[i] || 0);
      if(av !== bv) return av - bv;
    }
    return 0;
  };
  const pickMaxByTuple = (list, extractor) => {
    const packed = [];
    for(const item of list){
      const tuple = extractor(item);
      if(tuple) packed.push({ item, tuple });
    }
    if(!packed.length) return '';
    packed.sort((x, y) => compareTuple(x.tuple, y.tuple));
    return packed[packed.length - 1].item;
  };

  if(/^VER-/i.test(cur)){
    const family = rows.filter(v => /^VER-/i.test(v));
    const hit = pickMaxByTuple(family, v => {
      const m = v.match(/^VER-(\d+)(?:-(\d+))?(?:-(\d+))?/i);
      if(!m) return null;
      return [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)];
    }) || family[0];
    if(hit) return hit;
  }
  if(/^chrome\//i.test(cur)){
    const family = rows.filter(v => /^chrome\/m\d+/i.test(v));
    const hit = pickMaxByTuple(family, v => {
      const m = v.match(/^chrome\/m(\d+)/i);
      if(!m) return null;
      return [Number(m[1] || 0)];
    }) || family[0];
    if(hit) return hit;
  }
  if(semverLike(cur)){
    const family = rows.filter(v => semverLike(v));
    const hit = pickMaxByTuple(family, v => {
      const clean = v.replace(/^v/i, '').split(/[+-]/)[0];
      const parts = clean.split('.').map(x => Number(x || 0));
      return parts.length ? parts : null;
    }) || family[0];
    if(hit) return hit;
  }
  const nonMeta = rows.find(v => !/(start|test|rc|alpha|beta)/i.test(v));
  return nonMeta || rows[0] || '';
}

function maybeUpdateRuntimeRow(row, latestTag){
  if(!row || typeof row !== 'object') return false;
  const currentVersion = String(row.version || '').trim();
  const nextVersion = normalizeVersionForPath(latestTag);
  if(!nextVersion || nextVersion === currentVersion) return false;

  row.version = nextVersion;
  if(row.file){
    row.file = rewriteVersionedPath(row.file, nextVersion);
  }
  if(row.wrapperFile){
    row.wrapperFile = rewriteVersionedPath(row.wrapperFile, nextVersion);
  }
  if(row.source && row.source.type === 'remote-url'){
    if(row.source.url){
      row.source.url = rewriteRemoteUrlVersion(String(row.source.url), currentVersion, nextVersion);
    }
    if(row.source.wrapperUrl){
      row.source.wrapperUrl = rewriteRemoteUrlVersion(String(row.source.wrapperUrl), currentVersion, nextVersion);
    }
    if(row.source.jsUrl){
      row.source.jsUrl = rewriteRemoteUrlVersion(String(row.source.jsUrl), currentVersion, nextVersion);
    }
  }
  return true;
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

function normalizeUts39Pairs(pairs){
  return (Array.isArray(pairs) ? pairs : [])
    .map((row) => ({
      source: Number(row && row.source || 0),
      target: Number(row && row.target || 0),
      class: String(row && row.class || 'moderate'),
      label: String(row && row.label || '')
    }))
    .filter((row) => row.source > 0 && row.target > 0)
    .sort((a, b) => (
      a.source - b.source ||
      a.target - b.target ||
      a.class.localeCompare(b.class) ||
      a.label.localeCompare(b.label)
    ));
}

function computeUts39ContentSha(pairs){
  const normalized = normalizeUts39Pairs(pairs);
  return sha256Hex(Buffer.from(JSON.stringify(normalized) + '\n', 'utf8'));
}

function readExistingUts39DatasetFingerprint(filePath){
  try{
    if(!fs.existsSync(filePath)) return { contentSha256: '', sourceSha256: '' };
    const gz = fs.readFileSync(filePath);
    const text = zlib.gunzipSync(gz).toString('utf8');
    const parsed = JSON.parse(text);
    return {
      contentSha256: computeUts39ContentSha(parsed && parsed.pairs),
      sourceSha256: String(parsed && parsed.sourceSha256 || '').trim().toLowerCase()
    };
  }catch(_e){
    return { contentSha256: '', sourceSha256: '' };
  }
}

function buildUts39Version(isoNow, contentSha256){
  const day = String(isoNow || '').slice(0, 10) || 'uts39';
  const shortHash = String(contentSha256 || '').trim().toLowerCase().slice(0, 12);
  return shortHash ? `${day}-${shortHash}` : day;
}

function maybeUpdateUts39Row(row, nextVersion){
  if(!row || typeof row !== 'object') return false;
  const currentVersion = String(row.version || '').trim();
  if(!nextVersion || nextVersion === currentVersion) return false;
  row.version = nextVersion;
  if(row.file){
    row.file = rewriteVersionedPath(row.file, nextVersion);
  }
  return true;
}

function writeJson(filePath, value){
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function main(){
  const srcPath = process.argv[2] || 'manifests/runtime-sources.json';
  const sources = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  const now = new Date().toISOString();
  const report = { updates: [] };

  for(const [kind, row] of Object.entries(sources.engines || {})){
    const upstream = row && row.upstream ? row.upstream : {};
    const currentTag = String(upstream.tag || '').trim();
    const latest = await latestTagFromRepo(upstream.repo, currentTag);
    const shouldUpdateVersion = row && row.autoUpdateVersion !== false;
    const updateAvailable = !!(latest && currentTag && latest !== currentTag);
    if(updateAvailable && shouldUpdateVersion && maybeUpdateRuntimeRow(row, latest)){
      row.upstream = Object.assign({}, upstream, {
        tag: latest,
        latestSeen: latest,
        checkedAt: now
      });
      report.updates.push({
        kind: `engine:${kind}`,
        current: currentTag,
        latest,
        versionChanged: true
      });
    }else if(updateAvailable && !shouldUpdateVersion){
      console.log(`Pinned engine update available: engine:${kind} ${currentTag} -> ${latest}`);
    }
  }

  for(const [kind, row] of Object.entries(sources.datasets || {})){
    if(String(row && row.source && row.source.type || '') !== 'uts39-generate'){
      continue;
    }
    const upstream = row && row.upstream ? row.upstream : {};
    const url = String(row && row.source && row.source.url || '').trim();
    if(!url) continue;

    try{
      const raw = await fetchText(url);
      const pairs = parseUts39Pairs(raw);
      const nextContentSha = computeUts39ContentSha(pairs);
      const existing = readExistingUts39DatasetFingerprint(path.resolve(process.cwd(), String(row.file || '')));
      const currentContentSha = String(upstream.contentSha256 || existing.contentSha256 || '').trim().toLowerCase();
      if(nextContentSha && nextContentSha !== currentContentSha){
        const previousVersion = String(row.version || '').trim();
        const nextVersion = buildUts39Version(now, nextContentSha);
        const versionChanged = maybeUpdateUts39Row(row, nextVersion);
        row.upstream = Object.assign({}, upstream, {
          contentSha256: nextContentSha,
          sourceSha256: sha256Hex(Buffer.from(raw, 'utf8')),
          sourceUrl: url,
          checkedAt: now
        });
        report.updates.push({
          kind: `dataset:${kind}`,
          current: currentContentSha || previousVersion,
          latest: nextContentSha,
          versionChanged
        });
      }
    }catch(err){
      console.warn(`Skipped dataset:${kind} upstream check: ${String(err && err.message || err)}`);
    }
  }

  writeJson(srcPath, sources);
  writeJson('manifests/upstream-status.json', report);

  if(report.updates.length){
    console.log('Upstream updates detected:');
    for(const u of report.updates){
      console.log(`- ${u.kind}: ${u.current} -> ${u.latest}${u.versionChanged ? ' (version updated)' : ''}`);
    }
  }else{
    console.log('No upstream updates detected');
  }
}

main();
