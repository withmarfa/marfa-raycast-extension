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

- **Staging:** `http://100.127.105.110:8602` (V0 server)
- **Staging API key:** in `~/aic-local/Dev/MymeHQ/mock-myme/.env`
- Use staging for testing. Do not write test data to production

## Commands

- **Browse** -- list items with date grouping, type icons, metadata. Paginated with auto-loading. Native Raycast filtering within loaded items. Type filter dropdown
- **Search** -- full-text search with debounced input. Shows snippets and metadata
- **Quick Capture** -- create notes, bookmarks, tasks, or events with type-specific fields and validation
- **Clipboard Capture** -- no-view command. Reads clipboard, detects URL vs text, creates a bookmark or note instantly

## Action panel

All items: View Detail, Copy Title/ID, Add/Remove Tags, Reply (in-thread edge), Annotate (annotates edge → core.highlight), State transitions (Active/Archived/Trash), Delete Permanently

Bookmarks additionally: Open in Browser (primary action), Copy URL

Trashed items: Restore action

## Dependencies

- **@mymehq/sdk** -- TypeScript HTTP client (from npm), pinned to `^3.0.0` (V0)
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
