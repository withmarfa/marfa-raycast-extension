# Myme Raycast Extension

Raycast extension for browsing, searching, and capturing Myme items.

## Build and run

```bash
pnpm install
pnpm dev         # development mode in Raycast
pnpm build       # production build
pnpm lint        # lint with Raycast rules (ESLint 9 flat config)
```

## Configuration

Extension preferences (set in Raycast):

- **API URL** -- Myme server URL (default: `http://localhost:8600`)
- **API Key** -- authentication key (password field)

## Testing

- Point the extension at a non-production V0 server during development; never write test data to a production instance.
- The staging URL and admin key live in your local `.env` for the conformance suite — re-use them rather than hardcoding here.

## Commands

- **Browse** -- list items with date grouping, type icons, metadata. Paginated with auto-loading. Native Raycast filtering within loaded items. Type filter dropdown
- **Search** -- full-text search with debounced input. Shows snippets and metadata
- **Quick Capture** -- create notes, bookmarks, tasks, or events with type-specific fields and validation
- **Clipboard Capture** -- no-view command. Reads clipboard, detects URL vs text, creates a bookmark or note instantly
- **Manage Keys** -- admin-only CRUD over `/keys`. List / detail / create (one-shot plaintext key view) / edit (label, default origin/library, three permission maps; `source` and `role` are immutable) / revoke (confirm-gated soft delete). Member keys see an "admin credentials required" empty state instead

## Action panel

All items: View Detail, Copy Title/ID, Add/Remove Tags, Reply (in-thread edge), Annotate (annotates edge → core.highlight), State transitions (Active/Archived/Trash), Delete Permanently

Bookmarks additionally: Open in Browser (primary action), Copy URL

Trashed items: Restore action

## Dependencies

- **@mymehq/sdk** -- TypeScript HTTP client (from npm), pinned to `^3.1.0` (adds `client.keys.update` for the Manage Keys edit flow)
- **@raycast/utils** -- useCachedPromise, showFailureToast, getFavicon

## V0 contract notes

- **Lifecycle is three-value:** `active | archived | trashed`. There is no `new` state.
- **Library filter is opt-in:** the V0 server no longer defaults `library: true` on `/items` or `/search`. Browse and Search pass `library: true` explicitly to preserve curated-only behaviour. Quick Capture and Clipboard Capture stamp `library: true` to mirror the user-captured intent.
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
