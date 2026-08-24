# Community source cleanup plan

Date: 2026-08-23

## Goal

Turn the sanitized 2026-07-02 snapshot into a smaller, code-documented community source tree without removing any feature that is reachable from the web, desktop, Docker, BFF, or package-script entry points.

## Source-of-truth rules

- Frontend reachability starts at `src/main.tsx` and includes static imports, re-exports and literal dynamic imports.
- Backend reachability starts at `bff/server.js` and includes every mounted router and handler.
- Package scripts, Electron, Docker, Nginx, migration SQL and compatibility migrations are independent entry points and are not classified as dead code merely because Vite does not import them.
- A file is removed only when its symbol/path has no external reference and the production build still passes after removal.

## Execution

1. Save a rollback archive of the community directory.
2. Remove generated dependencies and proven unreachable source modules.
3. Rewrite public documentation from current entry points, routes, settings and runtime configuration.
4. Reinstall from lockfiles and verify encoding, build, backend syntax/startup, dependency audits and browser startup.
5. Remove generated dependencies and build output again before delivery.

## Deliberately retained compatibility code

Legacy project-schema migration, deprecated persisted fields and old chapter-status normalization remain because they are read by current storage migration code. Deleting them would break existing browser projects even though new projects no longer write every field.

## Result

- A rollback archive was created before cleanup.
- 22 unreachable frontend source files were removed; all 38 BFF runtime modules were retained.
- Public documentation was rewritten from current entry points, routes, configuration and runtime behavior.
- Configuration loading and empty-project BYOK persistence defects found during runtime testing were fixed.
- Fresh-install build, backend startup, browser smoke test, dependency audit and final source scans are the release gate.
