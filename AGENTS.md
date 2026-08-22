# Marfa Raycast Extension

Raycast extension for browsing, searching, and capturing Marfa items.

## Build and run

```bash
npm install
npm run dev         # development mode in Raycast
npm run build       # production build
npm run lint        # lint with Raycast rules (ESLint 9 flat config)
npm run typecheck   # tsc --noEmit. Faster signal than `ray build` for type errors
```

Standard Raycast extension layout: `npm` + `package-lock.json`, no workspace files. Two gotchas baked into config:

- **`.npmrc` carries `legacy-peer-deps=true`.** Documented workaround for an npm-7+ strict-peer-deps quirk in the eslint-9 toolchain that `@raycast/eslint-config@2.x` pulls in. Without it, `npm install` errors on a transitive `knip` devDependency in `@eslint-community/eslint-utils`.
- **`@types/react` and `@types/node` are pinned to exact versions.** They match what `@raycast/api` declares as peer deps. Drifting to `^` ranges duplicates the React type tree under `node_modules/@raycast/api/node_modules/@types/react` and breaks `tsc --noEmit`.

## Configuration

Extension preferences (Raycast → Extensions → Marfa):

- **Server URL:** required, no default. Raycast prompts on first run.
- **API Key:** optional dev/escape-hatch static key. Normal use is OAuth, triggered automatically on first command run. Leave empty unless you want a static-key fallback.
- **Default tier:** `library` (default) or `feed`. Stamped on every captured item.
- **Default capture type:** any registered Marfa type id, e.g. `core.note` (default) or `example.type`. Core capture types use native fields; other types use a generic properties JSON editor. Clipboard file and URL routing still win when content implies a stronger type.
- **Default tags:** comma-separated tags merged into every capture (e.g. `raycast, mobile`).
- **Capture location:** when on, every capture invokes a macOS Shortcut named `Marfa Capture Location` and stamps `capture_latitude` / `capture_longitude` on the item. The Shortcut must output `lat,lon` on stdout. Best-effort: a missing shortcut or denied permission falls through silently and the capture proceeds without location.

## Auth

Implicit OAuth on first use, following the canonical Raycast pattern. Every command's default export is wrapped with `withMarfaAccessToken(...)`, a thin local wrapper over `withAccessToken({ authorize, client: pkceClient, personalAccessToken })` from `@raycast/utils`.

- **Endpoints and scopes come from the server, not from this repo.** `src/auth/discovery.ts` reads the instance's RFC 8414 document (`/.well-known/oauth-authorization-server`), takes its three endpoints, and expands the `marfa_permission_bundles` it advertises into the scope string. Cached in `LocalStorage` per issuer for a day; a full sign-in always re-reads. The hardcoded paths and scope list survive only as the fallback for a server that serves no document.
- **Bundles cover content, not capabilities.** The advertised bundles name item types. They say nothing about edges, metadata or `offline_access`, which are operations this extension performs whatever content it is granted, so `CAPABILITY_SCOPES` is unioned in. Removing that union silently breaks tagging, the detail view's edges, and the type registry itself.
- **OAuth path (API Key empty):** first invocation against a new server triggers DCR against the advertised registration endpoint (persisting `client_id` in `LocalStorage` keyed by issuer) and PKCE consent. Later invocations refresh silently when the access token expires.
- **A grant narrower than what the server offers triggers exactly one re-consent.** `missingScopes` compares by coverage, not set difference, so a token holding `core.*:read` is not treated as short of `core.note:read`; only a scope nothing held can satisfy counts. An unknown or empty grant never prompts. Use `typeMatchesPattern` for this, never `matchesTypePattern` (which takes a list, so a bare string silently matches on the `*` character). `scopeCovers` used to be on that list because it compared patterns exactly and reported no coverage at all for a wildcard grant; that was fixed in `@withmarfa/shared` (T-734) and it now honours wildcards and refuses edge, metadata and OIDC scopes. Keep using the local `missingScopes`, which is scoped to this extension's re-consent decision rather than to a single type-and-operation question.
- **Static-key path:** `src/client.ts` builds `MarfaClient` from the static API key when set, using Raycast's `personalAccessToken` path so commands do not force OAuth before the SDK can use the key. Otherwise the client uses the global OAuth access token resolved by the HOC via a thin `tokenProvider`.
- **No Sign In or Sign Out command.** Sign-out is the Raycast-built-in **Logout** option that auto-surfaces in extension settings once tokens are stored.

## Testing

- Point the extension at a staging Marfa server during development.
- First run of any command triggers OAuth consent: Better Auth sign-in, then approve.
- For static-key smoke testing, paste an admin key into Preferences → API Key.

## Commands

Browse, Search and Quick Capture are the three a person runs daily and the only three on the root launcher. Everything else ships `disabledByDefault` and is switched on in Raycast's extension settings when it is actually wanted — which keeps the launcher uncluttered and stops an unfamiliar user walking into an admin surface.

- **Browse:** list items with date grouping, type icons, metadata. Paginated with auto-loading. Native Raycast filtering within loaded items. Tier filter in the search accessory; type and lifecycle filters in the action panel. Custom types discovered from the server registry where available. `⌘D` toggles the inline detail panel (per-command, persisted via `useCachedState`).
- **Search:** full-text search with debounced input. Shows snippets and metadata. Shares tier, type, and lifecycle filtering with Browse. Same `⌘D` detail toggle.
- **Quick Capture:** create core notes, bookmarks, tasks, or events with native type-specific fields and validation. Free-form "Additional properties" field accepts `key: value` lines for ad-hoc properties (booleans/numbers coerced; shadow keys rejected). Other registered types use a generic properties JSON editor with schema context. Honors capture preference defaults.

### Disabled by default (enable in Raycast Preferences → Extensions → Marfa)

- **Manage Keys:** admin-only CRUD over `/keys`. List / detail / create (one-shot plaintext key view) / edit (label, default tier, four permission maps; `source` and `role` are immutable) / revoke (confirm-gated soft delete). Supports `metadata_permissions` and `space_admin`. Non-admin principals see an "admin credentials required" empty state.
- **Clipboard Capture:** no-view command. Reads clipboard, routes by content: URL → bookmark; file → `core.file`; HTML-rich text → note (with `html` preserved); plain text → note. Uploads blobs via `client.blobs.upload`. Disabled while the redo bakes; flip on once verified.
- **Clipboard Capture (Edit):** view command. Pre-fills a form from the clipboard, lets the user adjust type / fields before submitting. File clipboard content routes to `core.file`; non-file content can use the configured default type, including custom types.
- **Server Info:** read-only view of the connected instance, auth mode, and signed-in identity.
- **Type Registry:** read-only list of every type registered on the instance (core / custom / system). Detail per type shows the full schema JSON.

## Action panel

- **All items:** View Detail, Copy Title/ID, Add/Remove Tags, Reply (in-thread edge), Annotate (`references` edge → `core.highlight`), State transitions (Active/Archived/Trash).
- **Bookmarks also:** Open in Browser (primary action), Copy URL.
- **Trashed items:** Restore, Delete Permanently (irreversible purge). When the lifecycle filter is set to **Trash**, an **Empty Trash** action (⌘⇧⌫) is surfaced; it calls `items.bulkAction({ action: 'purge', confirm: 'PURGE', filter: { state: 'trashed' } })` behind a `confirmAlert` gate.

## Dependencies

- **@raycast/api:** Raycast platform SDK. Carries every Raycast primitive (`List`, `Form`, `Detail`, `Action`, `OAuth.PKCEClient`, `LocalStorage`, `Clipboard`, etc.). `package.json` is the source of truth for the version floor.
- **@raycast/utils:** `withAccessToken`, `getAccessToken`, `useCachedPromise`, `showFailureToast`, `getFavicon`. The OAuth HOC is what makes implicit-auth-on-first-use work.
- **@withmarfa/sdk:** TypeScript HTTP client (from npm). `package.json` is the source of truth for the version floor.

## How a type is displayed

**Display comes from the instance's type registry, not from a map in this repo.** `src/type-display.ts` builds a resolver over the schemas the server returns; `src/use-type-registry.ts` is the hook every view uses to get one. Marfa is self-hostable and instances register their own types, so a hardcoded table can only ever describe the types someone remembered to add.

Resolution order:

- **Label** — curated override (there are none), then `schema.label`, then the humanised last segment of the identifier.
- **Item title and body** — `display_hints.title_field` and `body_field`, walking `parent` through the fetched schemas, then the conventional property names in `helpers.ts`, then the type's label. The conventional names are wrong for plenty of real types: a captured email titles by `subject`, not `title`.
- **Icon and colour** — `CURATED_APPEARANCE`, inherited by a family root through `parent`, else a per-tier default keyed on `classifyNamespace` from `@withmarfa/shared`.

Two rules worth keeping:

- **Walk ancestry across the fetched schema list, never through shared's `getTypeSchema`/`isSubtypeOf`.** Those resolve against the vocabulary compiled into the package and cannot know what a given instance registered. The grammar helpers (`classifyNamespace`, `isSystemType`) are instance-independent and are safe to call directly.
- **Do not extend `CURATED_APPEARANCE` to cover integration or publisher types.** It exists only where a distinct glyph carries recognition a label cannot, which is true of the core vocabulary and essentially nothing else. Its `satisfies` clause pins those identifiers so a platform rename fails the build; widening it to integration types would buy a build check at the cost of the flexibility the resolver exists to provide.

## Server contract notes

- **Lifecycle:** `active | archived | trashed | revoked`. core/custom items use the active/archived/trashed graph; system.* items use active/revoked. The extension only operates on user-facing items, so it surfaces the three-state subset.
- **Tier:** items carry `tier: 'library' | 'feed'`. Quick Capture, Clipboard Capture, Reply, and Annotate stamp `tier: 'library'` to mirror user-captured intent. Browse and Search pass an explicit `tier` filter (`library` | `feed` | `all`). `system.*` items have no tier; the detail view renders `—` if it ever encounters one.
- **Typed edges:** the Item shape carries no `parent_id`, `thread_id`, or `metadata.about`. Relationships are first-class typed edges: Reply creates an `in-thread` edge, Annotate creates a `references` edge. Atomic edge writes go through the `edges` field on `client.items.create`.
- **Source is server-stamped** from the credential, never set by the client.

## Conventions

- American English throughout.
- Follows Raycast extension patterns (useCachedPromise, Form, List, Detail).
- ESLint 9 flat config via `@raycast/eslint-config@2.x`. Prettier with single quotes, 100 char width.
- **Conventional Commits** for commit messages.
- Build outputs to `./dist/` (gitignored). Do not output to repo root; that path is destructive and removes `assets/` between runs.
- Lint uses `ray lint --relaxed`. `--relaxed` skips ray's store-publish icon validation, irrelevant for private use. `package-lock.json` is committed (npm canon). If this extension is ever submitted to the Raycast store, drop `--relaxed`.

## Comments

Comments are self-contained and make sense to anyone reading this repository cold. Explain *why* (the decision, constraint, or non-obvious trade-off), not the *what*, which the code already states. Never reference internal trackers, ticket numbers, or project phases; a comment that only points at external context is noise. If a comment doesn't earn its place by capturing intent, delete it.

## Local install

Standard Raycast extension idiom: the extension lives in your Raycast app, not in this repo, after a one-time dev-mode registration.

1. **First time after cloning:** `npm install && npm run dev` in this repo. Wait for the "Built extension" message, which means Raycast has registered it.
2. Hit `Ctrl+C` to stop dev mode.
3. The extension stays installed and usable in Raycast. Search for any of its commands (Browse, Search, Quick Capture, Manage Keys) from the Raycast root. The clipboard / server-info / type-registry commands ship `disabledByDefault`; enable them in Raycast Preferences → Extensions → Marfa.

Stopping dev mode loses hot reload (file edits don't propagate) and console-log streaming. The extension itself stays fully functional.

**Update ritual after pulling new code** (e.g. after a PR merges to main): run `npm run dev` briefly so Raycast picks up the fresh build, then `Ctrl+C` again.

## Adjacent context

Docs MCP convention: when working on documented surfaces (types, edges, runtime substrates, connections, auth flows), query the docs MCP at `https://docs.marfa.so/mcp` (or use `marfa docs search "<query>"` from CLI) before re-deriving from source. Docs live **only** in `withmarfa/docs`; never author docs pages in this repo. When a change touches a public surface, open a companion `withmarfa/docs` PR and link it.
