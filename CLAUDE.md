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

- **Staging:** `http://100.127.105.110:8601`
- **Staging API key:** in `~/aic-local/Dev/MymeHQ/mock-myme/.env`
- Use staging for testing. Do not write test data to production

## Commands

- **Browse** -- list items with date grouping, type icons, metadata. Paginated with auto-loading. Native Raycast filtering within loaded items. Type filter dropdown
- **Search** -- full-text search with debounced input. Shows snippets and metadata
- **Quick Capture** -- create notes, bookmarks, tasks, or events with type-specific fields and validation
- **Clipboard Capture** -- no-view command. Reads clipboard, detects URL vs text, creates a bookmark or note instantly

## Action panel

All items: View Detail, Copy Title, Copy ID, Add/Remove Tags, State transitions (Active/Archived/New/Trash), Delete Permanently

Bookmarks additionally: Open in Browser (primary action), Copy URL

Trashed items: Restore action

## Dependencies

- **@mymehq/sdk** -- TypeScript HTTP client (from npm)
- **@raycast/utils** -- useCachedPromise, showFailureToast, getFavicon

## Conventions

- American English throughout
- Follows Raycast extension patterns (useCachedPromise, Form, List, Detail)
- ESLint 9 flat config via `@raycast/eslint-config@2.x`
- Prettier with single quotes, 100 char width
