#!/usr/bin/env node
import fs from 'node:fs';

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
    const rows = [];
    for(const item of list){
      const tuple = extractor(item);
      if(tuple) rows.push({ item, tuple });
    }
    if(!rows.length) return '';
    rows.sort((x, y) => compareTuple(x.tuple, y.tuple));
    return rows[rows.length - 1].item;
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

async function main(){
  const srcPath = process.argv[2] || 'manifests/runtime-sources.json';
  const sources = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  const now = new Date().toISOString();

  const report = { checkedAt: now, updates: [] };

  for(const [kind, row] of Object.entries(sources.engines || {})){
    const upstream = row && row.upstream ? row.upstream : {};
    const current = String(upstream.tag || '');
    const latest = await latestTagFromRepo(upstream.repo, current);
    row.upstream = Object.assign({}, upstream, { latestSeen: latest, checkedAt: now });
    if(latest && current && latest !== current){
      report.updates.push({ kind: `engine:${kind}`, current, latest });
    }
  }

  for(const [kind, row] of Object.entries(sources.datasets || {})){
    const upstream = row && row.upstream ? row.upstream : {};
    row.upstream = Object.assign({}, upstream, { checkedAt: now });
  }

  fs.writeFileSync(srcPath, JSON.stringify(sources, null, 2) + '\n', 'utf8');
  fs.writeFileSync('manifests/upstream-status.json', JSON.stringify(report, null, 2) + '\n', 'utf8');

  if(report.updates.length){
    console.log('Upstream updates detected:');
    for(const u of report.updates){
      console.log(`- ${u.kind}: ${u.current} -> ${u.latest}`);
    }
  }else{
    console.log('No upstream updates detected');
  }
}

main();
