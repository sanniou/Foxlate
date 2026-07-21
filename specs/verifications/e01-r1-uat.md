# e01 R1 UAT

**Date:** 2026-07-22  
**Result:** PASS (user confirmed)

## Automated

- `npm test` → 84 pass / 0 fail
- `npm run build:firefox` + `npm run build:chrome` green
- `node --test test/build-manifest.test.mjs` green
- `node --test test/design-token-parity.test.mjs` green

## Manual (user)

1. Chrome dist load / version / service_worker — accepted
2. Firefox scripts shape — accepted
3. Options validation — accepted
4. Content palette light/dark — accepted
