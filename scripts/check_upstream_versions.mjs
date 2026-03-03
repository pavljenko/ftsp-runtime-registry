#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

async function fetchJson(url){
  const res = await fetch(url, { headers: { 'User-Agent': 'ftsp-runtime-registry-bot' } });
  if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
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
    const oldFile = String(row.file);
    const parsed = path.posix.parse(oldFile.replace(/\\/g, '/'));
    const dir = parsed.dir.split('/');
    if(dir.length >= 2){
      dir[dir.length - 1] = nextVersion;
      row.file = path.posix.join(dir.join('/'), parsed.base);
    }
  }
  if(row.source && row.source.type === 'remote-url' && row.source.url){
    row.source.url = rewriteRemoteUrlVersion(String(row.source.url), currentVersion, nextVersion);
  }
  return true;
}

async function main(){
  const srcPath = process.argv[2] || 'manifests/runtime-sources.json';
  const sources = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  const now = new Date().toISOString();

  const report = { checkedAt: now, updates: [] };

  for(const [kind, row] of Object.entries(sources.engines || {})){
    const upstream = row && row.upstream ? row.upstream : {};
    const currentTag = String(upstream.tag || '');
    const latest = await latestTagFromRepo(upstream.repo, currentTag);
    const shouldUpdateVersion = row && row.autoUpdateVersion !== false;
    const changedVersion = (latest && shouldUpdateVersion) ? maybeUpdateRuntimeRow(row, latest) : false;
    row.upstream = Object.assign({}, upstream, {
      latestSeen: latest || String(upstream.latestSeen || ''),
      checkedAt: now,
      tag: String(currentTag || latest || '')
    });
    if(latest && currentTag && latest !== currentTag){
      report.updates.push({ kind: `engine:${kind}`, current: currentTag, latest, versionChanged: changedVersion });
    }
  }

  for(const [kind, row] of Object.entries(sources.datasets || {})){
    const upstream = row && row.upstream ? row.upstream : {};
    row.upstream = Object.assign({}, upstream, { checkedAt: now });
    if(String(row && row.source && row.source.type || '') === 'uts39-generate'){
      row.version = now.slice(0, 10);
      if(row.file){
        const parsed = path.posix.parse(String(row.file).replace(/\\/g, '/'));
        const dir = parsed.dir.split('/');
        if(dir.length >= 2){
          dir[dir.length - 1] = row.version;
          row.file = path.posix.join(dir.join('/'), parsed.base);
        }
      }
    }
    void kind;
  }

  fs.writeFileSync(srcPath, JSON.stringify(sources, null, 2) + '\n', 'utf8');
  fs.writeFileSync('manifests/upstream-status.json', JSON.stringify(report, null, 2) + '\n', 'utf8');

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
