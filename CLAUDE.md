# Myme Raycast Extension

Raycast extension for browsing, searching, and quick-capturing Myme items.

## Build and run

```bash
pnpm install
pnpm dev         # development mode in Raycast
pnpm build       # production build
pnpm lint        # lint with Raycast rules
```

## Configuration

Extension preferences (set in Raycast):

- **API URL** -- Myme server URL
- **API Key** -- authentication key

## Commands

- **Browse** -- list items with date grouping and type icons
- **Search** -- full-text search with debounced input
- **Quick Capture** -- create items with type-specific fields

## Dependencies

- **@mymehq/sdk** -- TypeScript HTTP client (from npm)

## Conventions

- American English throughout
- Follows Raycast extension patterns (useCachedPromise, Form, List, Detail)
