# Myme Raycast Extension

Raycast extension for browsing, searching, and capturing Myme items.

## Build and run

```bash
pnpm install
pnpm dev         # development mode in Raycast
pnpm build       # production build
pnpm lint        # lint with Raycast rules (ESLint 9 flat config)
pnpm typecheck   # tsc --noEmit. Faster signal than `ray build` for type errors during dev work
```

*`pnpm-workspace.yaml` exists solely to satisfy pnpm 11's `allowBuilds` approval gate for `esbuild`'s postinstall — required because `ray build` invokes `pnpm install` internally and the gate would otherwise fail. Not a real workspace; this repo is single-package.*

## Configuration

Extension preferences (set in Raycast):

- **API URL** -- Myme server URL (required; no default — Raycast prompts on first run)
- **API Key** -- optional dev/escape-hatch API key. Normal use is OAuth via the **Sign in to Myme** command; this preference is left empty unless you want a static key fallback.

## Auth

OAuth-first via Raycast's native `OAuth.PKCEClient`. The **Sign in to Myme** command drives the PKCE auth-code flow: DCR-on-first-run (per issuer) against `/auth/oauth2/register`, browser consent at `/auth/oauth2/authorize`, code-for-tokens at `/auth/oauth2/token`. Tokens persist in Raycast's encrypted token store; the DCR `client_id` lives in `LocalStorage` keyed by issuer (re-sign-in skips DCR). Transparent refresh on access-token expiry via a `TokenProvider` shim that satisfies `MymeClient`'s OAuth contract.

The static API-key preference remains as a dev / escape-hatch fallback. Precedence on every command call (`src/client.ts`): OAuth tokens if present → `apiKey` preference if set → otherwise throw `MymeAuthMissingError` so the calling command can render a "Sign in to Myme" empty state.

## Testing

- Point the extension at `staging.myme.so` during development. The `authtest2` admin user lives there; sign in via the **Sign in to Myme** command (browser consent against `https://staging.myme.so/auth/authorize`).
- For static-key smoke testing the admin key lives in `~/.myme/admin.json` (chmod 600); paste into Preferences → API Key.

## Commands

- **Sign in to Myme** -- no-view command. Drives the PKCE auth-code flow via `OAuth.PKCEClient`; tokens persist in Raycast's encrypted store
- **Sign out of Myme** -- no-view command. Clears the stored session (DCR `client_id` retained so re-sign-in skips registration)
- **Browse** -- list items with date grouping, type icons, metadata. Paginated with auto-loading. Native Raycast filtering within loaded items. Type filter dropdown
- **Search** -- full-text search with debounced input. Shows snippets and metadata
- **Quick Capture** -- create notes, bookmarks, tasks, or events with type-specific fields and validation
- **Clipboard Capture** -- no-view command. Reads clipboard, detects URL vs text, creates a bookmark or note instantly
- **Manage Keys** -- admin-only CRUD over `/keys`. List / detail / create (one-shot plaintext key view) / edit (label, default tier, three permission maps; `source` and `role` are immutable) / revoke (confirm-gated soft delete). Non-admin principals see an "admin credentials required" empty state instead

## Action panel

All items: View Detail, Copy Title/ID, Add/Remove Tags, Reply (in-thread edge), Annotate (annotates edge → core.highlight), State transitions (Active/Archived/Trash), Delete Permanently

Bookmarks additionally: Open in Browser (primary action), Copy URL

Trashed items: Restore action

## Dependencies

- **@raycast/api** -- Raycast platform SDK. Carries every Raycast primitive (`List`, `Form`, `Detail`, `Action`, `OAuth.PKCEClient`, `LocalStorage`, `Clipboard`, etc.). `package.json` is the source of truth for the version floor.
- **@mymehq/sdk** -- TypeScript HTTP client (from npm). `package.json` is the source of truth for the version floor.
- **@raycast/utils** -- useCachedPromise, showFailureToast, getFavicon

## Server contract notes

- **Lifecycle:** `active | archived | trashed | revoked`. core/custom items use the active/archived/trashed graph; system.* items use active/revoked. The extension only operates on user-facing items, so it surfaces the three-state subset.
- **Tier:** items carry `tier: 'library' | 'feed'` (renamed from the old boolean `library`). Quick Capture, Clipboard Capture, Reply, and Annotate stamp `tier: 'library'` to mirror the user-captured intent. Browse and Search pass an explicit `tier` filter (`library` | `feed` | `all`). `system.*` items have no tier — the detail view renders `—` if it ever encounters one.
- **Typed edges:** the Item shape no longer carries `parent_id`, `thread_id`, or `metadata.about`. Relationships are first-class typed edges. Reply creates an `in-thread` edge; Annotate creates an `annotates` edge. Atomic edge writes go through the `edges` field on `client.items.create`.
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
3. The extension stays installed and usable in Raycast forever. Search for any of its commands (Browse, Search, Quick Capture, Clipboard Capture, Manage Keys) from the Raycast root. No terminal needed; no plist; no auto-start.

What you lose by stopping dev: hot reload (file edits don't propagate) and console-log streaming. What you keep: the extension itself — fully functional.

**Update ritual after pulling new code** (e.g. after a PR merges to main): run `pnpm dev` briefly so Raycast picks up the fresh build, then `Ctrl+C` again.
