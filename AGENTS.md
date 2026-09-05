# Marfa Raycast Extension

Raycast extension for browsing, searching, and capturing Marfa items.

## Build and run

```bash
npm install
npm run dev         # development mode in Raycast
npm run build       # production build
npm run lint        # lint with Raycast rules (ESLint 9 flat config)
npm run test        # vitest run
npm run typecheck   # tsc --noEmit. Faster signal than `ray build` for type errors
```

Standard Raycast extension layout: `npm` + `package-lock.json`, no workspace files. Three gotchas baked into config:

- **`.npmrc` carries `legacy-peer-deps=true`.** Documented workaround for an npm-7+ strict-peer-deps quirk in the eslint-9 toolchain that `@raycast/eslint-config@2.x` pulls in. Without it, `npm install` errors on a transitive `knip` devDependency in `@eslint-community/eslint-utils`.
- **`@types/react` and `@types/node` are pinned to exact versions.** They match what `@raycast/api` declares as peer deps. Drifting to `^` ranges duplicates the React type tree under `node_modules/@raycast/api/node_modules/@types/react` and breaks `tsc --noEmit`.
- **`scripts/check-withmarfa-versions.cjs` runs before `typecheck`, `dev`, and `build`, so none of them answer against a stale tree.** CI installs from the lockfile on a fresh checkout and is therefore always right, which means nothing in CI can notice that a working copy is not. A dependency bump merged without anyone reinstalling locally leaves the installed tree measuring a different `@withmarfa/*` version from the one the lockfile resolved, and both `tsc` and `ray develop`/`ray build` answer that wrong question silently. The guard compares each installed `@withmarfa/*` package's version against what `package-lock.json` actually resolved it to — not against `package.json`'s declared range, which `npm ls` checks and which a same-range bump (a minor within `^6.0.0`, say) satisfies whether or not anyone reinstalled. It names the offending package and both versions and exits non-zero in a fraction of a second; the fix is `npm ci --legacy-peer-deps`.

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
- **Bundles cover content, not operations.** The advertised bundles name item types. They say nothing about edges or metadata, which are operations this extension performs whatever content it is granted, nor about `offline_access`, which is not a permission over data at all. `ALWAYS_REQUESTED_SCOPES` is unioned in to cover both. Removing that union silently breaks tagging, the detail view's edges, and the type registry itself. It is not the platform's `capability.*` family, which names administrative surfaces and is granted only scope by scope.
- **OAuth path (API Key empty):** first invocation against a new server triggers DCR against the advertised registration endpoint (persisting `client_id` in `LocalStorage` keyed by issuer) and PKCE consent. Later invocations refresh silently when the access token expires.
- **The session records what it was given, not what it asked for.** A completed exchange writes both, keyed by issuer, and the re-consent check compares that pair against what the server advertises now. Recording only the request is what made a narrow grant permanent and invisible: the full advertised set was written down, a subset was issued, and every launch afterwards concluded there was nothing left to ask for.
- **The rule is "has anything changed since this exact ask produced this exact answer".** Not "is the grant short of the advertisement", which never terminates when a server issues less than it advertises: each consent returns the same grant and the next launch sees the same shortfall. Not "has the advertisement moved" either, which terminates but goes blind to a server that quietly narrows. Comparing the pair terminates and stays honest, so a scope permanently refused costs exactly one consent screen ever. A generated sweep asserts the decision reaches a fixed point within one round for every combination, which is the assertion that says the loop cannot come back.
- **A refresh response that omits `scope` means "as requested", and the stored scope is carried forward.** Writing the absence through would empty it roughly an hour after a sign-in, and every surface that explains an absence would quietly stop being able to, with a check run immediately after signing in seeing none of it.
- **Coverage is the platform's question, and `missingScopes` asks it.** Every pair goes to `grantCoversScope` from `@withmarfa/shared`. Do not reimplement the scope grammar here, however small the case looks. This file used to walk it, parsing the held scopes and comparing kinds and type patterns, and that copy disagreed with the real rule on the content category, where a grant of `content:read` reaches every type through a projection the copy had no arm for, so it reported the whole registry as unreadable to a session that could read all of it. It also treated any requirement it could not parse as covered, which is fail-open on exactly the axis where a new scope family would first appear. `grantCoversScope` carries its own warning about five comparisons beside it that compared text; a sixth was never going to end differently.
- **One line is deliberately not the platform's answer: an empty or unknown grant is missing nothing.** `grantCoversScope` reports an empty grant as covering nothing, which is right for its question and wrong for this one. A token whose scopes the server did not report is not evidence of a narrow grant, and the caller here decides whether to send a person back through consent. Deciding from that shortfall once discarded the session on every launch and presented as signing out immediately after signing in. A test states the disagreement, so removing the guard fails rather than reading as a tidy-up.
- **Coverage rather than set difference is still the property that matters.** A token holding `core.*:read` is not short of `core.note:read`, and treating it as short would re-prompt forever.
- **A narrower grant outranks a broader one, and the old copy had this backwards.** It returned on the first held pattern that matched with a sufficient verb, so a grant pairing a broad pattern with a narrower one at a lower verb, such as `core.*:write core.media.*:read`, read as covering writes everywhere. The request path resolves the other way: exact, then the longest matching subtree wildcard, then the global one. The old answer was therefore yes where the server says no, which is the direction that matters, because what reads this decides whether to tell someone their content is visible.
- **Static-key path:** `src/client.ts` builds `MarfaClient` from the static API key when set, using Raycast's `personalAccessToken` path so commands do not force OAuth before the SDK can use the key. Otherwise the client uses the global OAuth access token resolved by the HOC via a thin `tokenProvider`.
- **No Sign In or Sign Out command.** Sign-out is the Raycast-built-in **Logout** option that auto-surfaces in extension settings once tokens are stored.

## Testing

**Automated coverage is deliberately narrow: pure logic only.** Property classification and
display resolution are covered today. Scope grammar and the capture validators are the two other
surfaces that belong here and do not have tests yet, so a green suite is not yet evidence about
either. All four are functions taking values and returning values, which is where every defect
that has cost real time in this extension has lived. Component rendering is not harnessed and should not be, because the components are a
mechanical transform over data those functions produce and a render test would assert only that a
loop exists.

- **Tests live in `test/`, mirroring `src/`, and not beside the source.** `ray lint` runs ESLint
  over every file in the source directory, so a colocated test is a linted test. `ray build`
  compiles only the entry points the manifest declares and would never have bundled one, so lint
  is the whole of the reason.
- **`@raycast/api` ships no runtime.** Its manifest declares `types` and no `main`, `module` or
  `exports`, because Raycast injects the runtime when it builds. Anything importing an `Icon`, a
  `Color` or `LocalStorage` as a value is therefore unimportable under a plain Node runner, which
  is most of what is worth testing. `vitest.config.mts` aliases the package to `test/stubs/`,
  which doubles only what something under test actually imports. Types still resolve from the
  real package, so a stub cannot change what a source file is checked against. The `Icon` and
  `Color` proxies are the part a stub cannot keep honest: a member the platform renames still
  resolves through the proxy, and only `typecheck` sees that.
- **`pretest` runs the version guard**, for the same reason `pretypecheck` does. A test asserting
  agreement with `@withmarfa/shared` against a tree that drifted from the lockfile asserts
  nothing.

Manual verification against a real instance is still the thing that decides whether a change
works, and no suite here replaces it:

- Point the extension at a staging Marfa server during development.
- First run of any command triggers OAuth consent: Better Auth sign-in, then approve.
- For static-key smoke testing, paste an admin key into Preferences → API Key.

## Commands

Browse, Search and Quick Capture are the three a person runs daily and the only three on the root launcher. Everything else ships `disabledByDefault` and is switched on in Raycast's extension settings when it is actually wanted — which keeps the launcher uncluttered and stops an unfamiliar user walking into an admin surface.

- **Browse:** list items with date grouping, type icons, metadata. A row's icon is always its type's glyph; a favicon rides as an accessory when the item carries a URL, so a mixed list stays legible by type. Paginated with auto-loading. Native Raycast filtering, which narrows the items already loaded and says so in its placeholder rather than reading as a search; `cmd+shift+F` hands the typed text to the Search command, which is the one that queries the server. Tier filter in the search accessory; type and lifecycle filters in the action panel. Custom types discovered from the server registry where available. `⌘D` toggles the inline detail panel (per-command, persisted via `useCachedState`).
- **Search:** opens on the most recent items and switches to full-text search once something is typed, under the same filters either way, so a launch is useful before a query exists. Shows snippets on results and metadata on both. Shares tier, type, and lifecycle filtering with Browse. Same `⌘D` detail toggle.
- **Quick Capture:** create core notes, bookmarks, tasks, or events with native type-specific fields and validation. Free-form "Additional properties" field accepts `key: value` lines for ad-hoc properties (booleans/numbers coerced; shadow keys rejected). Other registered types use a generic properties JSON editor with schema context. Honors capture preference defaults.

### Disabled by default (enable in Raycast Preferences → Extensions → Marfa)

- **Manage Keys:** admin-only CRUD over `/keys`. List / detail / create (one-shot plaintext key view) / edit (label, default tier, four permission maps; `source` and `role` are immutable) / revoke (confirm-gated soft delete). Supports `metadata_permissions` and `space_admin`. Non-admin principals see an "admin credentials required" empty state.
- **Clipboard Capture:** no-view command. Reads clipboard, routes by content: URL → bookmark; file → `core.file`; HTML-rich text → note (with `html` preserved); plain text → note. Uploads blobs via `client.blobs.upload`. Disabled while the redo bakes; flip on once verified.
- **Clipboard Capture (Edit):** view command. Pre-fills a form from the clipboard, lets the user adjust type / fields before submitting. File clipboard content routes to `core.file`; non-file content can use the configured default type, including custom types.
- **Server Info:** read-only view of the connected instance, auth mode, and signed-in identity. Auth mode is derived from the credential the client is using, never from whether a call succeeded: the profile route is gated on a scope no shipped bundle grants, so a browser sign-in usually cannot read its own identity, and reporting that refusal as "API key" pointed diagnosis at the wrong preference. The refusal is named instead.
- **Type Registry:** read-only list of every type registered on the instance (core / custom / system), with each row carrying its type's own glyph from the display resolver. Opening one lists its fields, resolved through the type's ancestry, with each field's kind, whether it is required, and an enum's actual values. The raw schema is a copy action rather than the view.

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

- **Label** — curated override (there are none), then `schema.label`, then the humanized last segment of the identifier.
- **Item title and body** — `display_hints.title_field` and `body_field`, walking `parent` through the fetched schemas, then the conventional property names in `helpers.ts`, then the type's label. The conventional names are wrong for plenty of real types: a captured email titles by `subject`, not `title`.
- **Icon and color** — `CURATED_APPEARANCE`, inherited by a family root through `parent`, else a per-tier default keyed on `classifyNamespace` from `@withmarfa/shared`.

Two rules worth keeping:

- **Required-ness is declared two ways and both are read.** The platform's schema validator accepts a top-level `["title"]` array and a per-field `required: true`, normalizing the first into the second, which is why a current server shows only the flags. The extension read only the array, found none, and therefore validated nothing: every type reported requiring nothing and no capture was refused before it reached the network. `requiredFieldNames` unions both, through the type's ancestry.
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

## CI

Runs on a managed ARM runner rather than the local self-hosted pool, selected by the repository variable `CI_RUNNER`. The workflow reads it directly, so returning this repository to local CI is a variable change and nothing else.

- **The npm cache is enabled unconditionally**, which is correct here and worth stating because the sibling repositories condition theirs. Those are pnpm and share a persistent store on the local pool, where caching costs more than it saves; this repository is npm on an ephemeral runner that keeps nothing between jobs, so there is nothing to condition on. Any reasoning about the pnpm cache condition simply does not describe this repository.
- **`npm ci --legacy-peer-deps`** in CI, matching the `.npmrc` above rather than relying on it.
- **Measured at parity on the managed runner**, 32 seconds against 31 locally, which is why it moved without argument. The jobs that do not travel well are the ones asserting a duration, a rate, or a burst crossing a threshold; this extension has none.

## Comments

Comments are self-contained and make sense to anyone reading this repository cold. Explain *why* (the decision, constraint, or non-obvious trade-off), not the *what*, which the code already states. Never reference internal trackers, ticket numbers, or project phases; a comment that only points at external context is noise. If a comment doesn't earn its place by capturing intent, delete it.

## Local install

Standard Raycast extension idiom: the extension lives in your Raycast app, not in this repo, after a one-time dev-mode registration.

1. **First time after cloning:** `npm install && npm run dev` in this repo. Wait for the "Built extension" message, which means Raycast has registered it.
2. Hit `Ctrl+C` to stop dev mode.
3. The extension stays installed and usable in Raycast. Search for any of its commands (Browse, Search, Quick Capture, Manage Keys) from the Raycast root. The clipboard / server-info / type-registry commands ship `disabledByDefault`; enable them in Raycast Preferences → Extensions → Marfa.

Stopping dev mode loses hot reload (file edits don't propagate) and console-log streaming. The extension itself stays fully functional.

**Update ritual after pulling new code** (e.g. after a PR merges to main): run `npm ci --legacy-peer-deps` if the pull touched `package-lock.json`, then `npm run dev` briefly so Raycast picks up the fresh build, then `Ctrl+C` again. `npm run dev` installs nothing, so skipping the install leaves the built extension running against whatever was on disk before — `predev` now refuses to build against a tree that drifted from the lockfile rather than doing so silently.

## Adjacent context

Docs MCP convention: when working on documented surfaces (types, edges, runtime substrates, connections, auth flows), query the docs MCP at `https://docs.marfa.so/mcp` (or use `marfa docs search "<query>"` from CLI) before re-deriving from source. Docs live **only** in `withmarfa/docs`; never author docs pages in this repo. When a change touches a public surface, open a companion `withmarfa/docs` PR and link it.
