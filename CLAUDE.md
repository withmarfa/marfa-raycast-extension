# Myme Raycast Extension

Raycast extension for browsing, searching, and capturing Myme items.

## Build and run

```bash
npm install
npm run dev         # development mode in Raycast
npm run build       # production build
npm run lint        # lint with Raycast rules (ESLint 9 flat config)
npm run typecheck   # tsc --noEmit. Faster signal than `ray build` for type errors during dev work
```

This is a standard Raycast extension layout — `npm` + `package-lock.json`, no workspace files. An `.npmrc` carrying `legacy-peer-deps=true` is the documented workaround for an npm-7+ strict-peer-deps quirk in the eslint-9 toolchain that `@raycast/eslint-config@2.x` brings in; without it `npm install` errors on a transitive `knip` devDependency in `@eslint-community/eslint-utils`. Both `@types/react` and `@types/node` are pinned to the exact versions `@raycast/api` declares as peer deps — drifting to `^` ranges duplicates the React type tree under `node_modules/@raycast/api/node_modules/@types/react` and breaks `tsc --noEmit`.

## Configuration

Extension preferences (set in Raycast → Extensions → Myme):

- **Server URL** -- Myme server URL (required; no default — Raycast prompts on first run)
- **API Key** -- optional dev/escape-hatch static key. Normal use is OAuth, triggered automatically on first command run. Leave empty unless you want a static-key fallback.
- **Default tier** -- `library` (default) or `feed`. Stamped on every captured item.
- **Default capture type** -- any registered Myme type id, e.g. `core.note` (default) or `example.type`. Core capture types use native fields; other types use a generic properties JSON editor. Clipboard file and URL routing still win when content implies a stronger type.
- **Default tags** -- comma-separated tags merged into every capture (e.g. `raycast, mobile`).

## Auth

Implicit OAuth on first use, following the canonical Raycast pattern. Every command's default export is wrapped with `withMymeAccessToken(...)`, a tiny local wrapper over `withAccessToken({ authorize, client: pkceClient, personalAccessToken })` from `@raycast/utils`. When the API Key preference is empty, the first invocation against a new server triggers DCR (`POST /auth/oauth2/register`, persists `client_id` in `LocalStorage` keyed by issuer) and PKCE consent (browser open via Raycast's overlay → `/auth/oauth2/authorize` → token exchange at `/auth/oauth2/token`). Subsequent invocations refresh silently when the access token is expired. **There is no visible Sign In or Sign Out command** — sign-out is the Raycast-built-in **Logout** option that auto-surfaces in extension settings once tokens are stored.

`src/client.ts` builds the `MymeClient` from the static API key when one is set, otherwise from the global OAuth access token resolved by the HOC via a tiny `tokenProvider`. Static-key mode uses Raycast's `personalAccessToken` path so commands do not force OAuth before the SDK can use the key.

## Testing

- Point the extension at `staging.myme.so` during development. The `authtest2` admin user lives there.
- First run of any command triggers OAuth consent against staging — Better Auth sign-in, then approve.
- For static-key smoke testing the admin key lives in `~/.myme/admin.json` (chmod 600); paste into Preferences → API Key.

## Commands

- **Browse** -- list items with date grouping, type icons, metadata. Paginated with auto-loading. Native Raycast filtering within loaded items. Tier filter in the search accessory; type and lifecycle filters in the action panel. Custom types are discovered from the server registry where available.
- **Search** -- full-text search with debounced input. Shows snippets and metadata. Shares tier, type, and lifecycle filtering with Browse.
- **Quick Capture** -- create core notes, bookmarks, tasks, or events with native type-specific fields and validation. Other registered types use a generic properties JSON editor with schema context. Honours capture preference defaults.
- **Manage Keys** -- admin-only CRUD over `/keys`. List / detail / create (one-shot plaintext key view) / edit (label, default tier, four permission maps; `source` and `role` are immutable) / revoke (confirm-gated soft delete). Supports `metadata_permissions` and `workspace_admin`. Non-admin principals see an "admin credentials required" empty state instead.

### Disabled by default (enable in Raycast Preferences → Extensions → Myme)

- **Clipboard Capture** -- no-view command. Reads clipboard, routes by content: URL → bookmark; file → `core.file`; HTML-rich text → note (with `html` preserved); plain text → note. Uploads blobs via `client.blobs.upload`. **Disabled by default while the redo bakes** — flip on once verified
- **Clipboard Capture (Edit)** -- view command. Pre-fills a form from the clipboard, lets the user adjust type / fields before submitting. File clipboard content routes to `core.file`; non-file content can use the configured default type, including custom types.
- **Server Info** -- read-only view of the connected instance, auth mode, and signed-in identity
- **Type Registry** -- read-only list of every type registered on the instance (core / custom / system). Detail per type shows the full schema JSON

## Action panel

All items: View Detail, Copy Title/ID, Add/Remove Tags, Reply (in-thread edge), Annotate (`references` edge → `core.highlight`), State transitions (Active/Archived/Trash)

Bookmarks additionally: Open in Browser (primary action), Copy URL

Trashed items: Restore action, Delete Permanently (irreversible purge)

## Dependencies

- **@raycast/api** -- Raycast platform SDK. Carries every Raycast primitive (`List`, `Form`, `Detail`, `Action`, `OAuth.PKCEClient`, `LocalStorage`, `Clipboard`, etc.). `package.json` is the source of truth for the version floor.
- **@raycast/utils** -- `withAccessToken`, `getAccessToken`, `useCachedPromise`, `showFailureToast`, `getFavicon`. The OAuth HOC is what makes implicit-auth-on-first-use work.
- **@mymehq/sdk** -- TypeScript HTTP client (from npm). `package.json` is the source of truth for the version floor.

## Server contract notes

- **Lifecycle:** `active | archived | trashed | revoked`. core/custom items use the active/archived/trashed graph; system.* items use active/revoked. The extension only operates on user-facing items, so it surfaces the three-state subset.
- **Tier:** items carry `tier: 'library' | 'feed'` (renamed from the old boolean `library`). Quick Capture, Clipboard Capture, Reply, and Annotate stamp `tier: 'library'` to mirror the user-captured intent. Browse and Search pass an explicit `tier` filter (`library` | `feed` | `all`). `system.*` items have no tier — the detail view renders `—` if it ever encounters one.
- **Typed edges:** the Item shape no longer carries `parent_id`, `thread_id`, or `metadata.about`. Relationships are first-class typed edges. Reply creates an `in-thread` edge; Annotate creates a `references` edge. Atomic edge writes go through the `edges` field on `client.items.create`.
- **Source is server-stamped** from the credential — never set by the client.

## Conventions

- American English throughout
- Follows Raycast extension patterns (useCachedPromise, Form, List, Detail)
- ESLint 9 flat config via `@raycast/eslint-config@2.x`
- Prettier with single quotes, 100 char width
- Build outputs to `./dist/` (gitignored). Do not output to repo root — that path is destructive and removes `assets/` between runs.
- Lint uses `ray lint --relaxed` — this repo is pnpm-based, and `--relaxed` skips ray's npm-specific `package-lock.json` check (plus the store-publish icon validation, which isn't relevant for private use). If this extension is ever submitted to the Raycast store, drop `--relaxed` and generate `package-lock.json` first.

## Local install

Standard Raycast extension idiom — the extension lives in your Raycast app, not in this repo, after a one-time dev-mode registration.

1. **First time after cloning:** `pnpm install && pnpm dev` in this repo. Wait for the "Built extension" message — that means Raycast has registered it.
2. Hit `Ctrl+C` to stop dev mode.
3. The extension stays installed and usable in Raycast forever. Search for any of its commands (Browse, Search, Quick Capture, Manage Keys) from the Raycast root. The clipboard / server-info / type-registry commands ship `disabledByDefault` — enable them in Raycast Preferences → Extensions → Myme when you want them.

What you lose by stopping dev: hot reload (file edits don't propagate) and console-log streaming. What you keep: the extension itself — fully functional.

**Update ritual after pulling new code** (e.g. after a PR merges to main): run `pnpm dev` briefly so Raycast picks up the fresh build, then `Ctrl+C` again.
