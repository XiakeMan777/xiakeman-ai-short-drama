# Community group and local-only account mode

Date: 2026-08-23

## Decision

The community frontend is local-first and does not expose a Xiakeman account login. The header login/account menu is replaced by a community-group entry that opens the supplied WeChat QR image.

## Frontend behavior

- Do not restore a Xiakeman browser session on startup.
- Do not show login, registration, logout, admin or Agent Key dialogs.
- Save main-workflow BYOK settings only in the current browser.
- Do not mount project cloud auto-sync or show cloud upload/import actions.
- Keep local projects, local import/export, user-configured model providers and upstream-provider credentials unchanged.
- Keep a small no-session compatibility value for the task panel so account-only background jobs stay dormant without issuing auth requests.

## Backend boundary

The BFF auth, cloud, admin and Agent routes remain mounted for headless/self-hosted integrations, but the community frontend does not call or advertise them. Removing those backend protocols is a separate compatibility-breaking change.

## Community dialog

The header button is visible on desktop and icon-only on narrow screens. Its dialog displays the supplied QR image, explains its purpose, and repeats the image's 2026-08-30 expiry warning so maintainers know when replacement is required.

## Verification

- Production build succeeds.
- Fresh browser load makes no `/api/auth/*` request.
- Header contains “交流群” and no “登录” button.
- Community dialog opens and the QR asset loads.
- API settings state that keys stay in the current browser.
- Local project import/export remains visible; account cloud actions are absent.
