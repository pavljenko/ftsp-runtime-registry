# FTSP Runtime Registry

Immutable runtime registry for FTSP on-demand runtime checks.

## Goals
- Pin runtime assets by version and SHA256.
- Deliver only from GitHub Releases.
- Block unpinned `latest/main` loading.
- Keep permissive licenses only.

## Layout
- `manifests/runtime-sources.json` - single source of truth for assets/versions.
- `manifests/runtime-index.stable.json` - stable channel manifest for FTSP.
- `manifests/runtime-index.candidate.json` - candidate channel manifest.
- `manifests/runtime-index.json` - alias to stable manifest.
- `manifests/runtime-index.sig` - detached SHA256 sidecar for stable manifest.
- `engines/*/<version>/...` - release artifacts staging.
- `licenses/NOTICE-*.txt` - per-engine notices.
- `.github/workflows/` - update and license gates.

## Channels
- `stable` for FTSP production.
- `candidate` for pre-release validation.

## Local commands
- Build manifests: `node scripts/build_runtime_index.mjs --channels stable,candidate`
- Validate manifest schema/pinning: `node scripts/validate_manifest.mjs manifests/runtime-index.stable.json`
- License gate: `node scripts/license_gate.mjs manifests`
- Upstream tags scan: `node scripts/check_upstream_versions.mjs manifests/runtime-sources.json`
- Create GitHub repo via API: `GITHUB_TOKEN=... ./scripts/create_remote_repo.sh pavljenko ftsp-runtime-registry public`

## Notes
- Current engine binaries are placeholders for integration wiring.
- Replace placeholder artifacts with real WASM builds before production use.
- `publish-release.yml` uploads all runtime assets and manifests to GitHub Releases on tag push (`v*`).
