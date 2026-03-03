# FTSP Runtime Registry

Public immutable runtime registry for FTSP on-demand runtime checks.

## Goals
- Deliver runtime assets from versioned GitHub Releases.
- Keep a moving `stable` channel alias for FTSP clients.
- Enforce SHA256 + signed manifest (`ed25519`, fallback `sha256-sidecar`).
- Allow only permissive licenses.

## Layout
- `manifests/runtime-sources.json` - source of truth for versions/assets.
- `engines/*/<version>/...` - built/copied runtime WASM assets.
- `uts39/<version>/confusables.json.gz` - generated UTS #39 dataset.
- `manifests/runtime-index.{stable,candidate}.json` - channel manifests.
- `manifests/runtime-index*.sig` - detached signature/sha sidecars.
- `licenses/NOTICE-*.txt` - license notices.

## Runtime channels
- `stable` - FTSP production channel (`releases/download/stable/...`).
- `candidate` - pre-release validation.

## Local commands
- Check upstream tags: `node scripts/check_upstream_versions.mjs manifests/runtime-sources.json`
- Set release tag: `node scripts/set_release_tag.mjs manifests/runtime-sources.json`
- Build assets: `node scripts/build_engine_assets.mjs manifests/runtime-sources.json`
  strict CI mode: `node scripts/build_engine_assets.mjs manifests/runtime-sources.json --strict-fetch`
- Build manifests: `node scripts/build_runtime_index.mjs --channels stable,candidate`
- Validate manifests: `node scripts/validate_manifest.mjs manifests/runtime-index.stable.json`
- License gate: `node scripts/license_gate.mjs manifests`
- Runtime smoke gate: `node scripts/runtime_smoke_gate.mjs`
- Collect release files: `node scripts/collect_release_assets.mjs dist`

## CI requirements
Set repository secret:
- `FTSP_RUNTIME_SIGNING_PRIVATE_KEY_B64` - ed25519 private key in PKCS8 DER (base64).
Generate keypair once:
- `node scripts/generate_signing_keypair.mjs`
- put `privateKeyPkcs8Base64` into the GitHub secret above
- keep `publicKeySpkiBase64` synced with FTSP constant `RUNTIME_REGISTRY_ED25519_PUBLIC_KEY_BASE64`
- current public key is stored in `manifests/signing-public-key.ed25519.spki.b64`

If the key is missing, manifests are built with `sha256-sidecar` fallback.

## Notes
- Runtime assets are fetched/generate-only in CI (`build_engine_assets.mjs`).
- `publish-release.yml` publishes both versioned tag release and `stable` alias release.
- `runtime-update.yml` auto-opens and auto-merges PRs only after validation, license, and smoke gates.
