# Marfa Raycast Extension

Raycast extension for capturing to Marfa and browsing what every app wrote there. Standard extension layout: npm with a committed lockfile, no workspace files.

## Build and run

```bash
npm install
npm run dev         # development mode in Raycast
npm run build
npm run lint        # ray lint --relaxed
npm run test        # vitest run
npm run typecheck   # faster signal than a build for type errors
```

Two gotchas are baked into the config and each fails quietly without them.

- **The React and Node type packages are pinned to exact versions**, matching what `@raycast/api` declares. Drifting to ranges duplicates the React type tree under the API package's own modules and breaks the type check.
- **A version guard runs before typecheck, dev, test and build, so none of them answer against a stale tree.** CI installs from the lockfile on a fresh checkout and is therefore always right, which means nothing in CI can notice that a working copy is not. The guard compares the installed `@withmarfa/*` packages against the version the lockfile **resolved**, not against the declared range, which a same-range bump satisfies whether or not anyone reinstalled. The fix is a clean install.

## The server

**The extension speaks to a Marfa server over HTTP through `@withmarfa/client`**, the TypeScript client generated from the server's API document. There is no local copy and no sync: every command reads and writes the server directly, so it needs the server to be reachable. `src/marfa.ts` is the one door to it; every call there returns what the server answered or throws, so a view never reads an error out of a successful value.

- **The contract integer is the client's to check.** A server speaking another contract makes every call throw `ContractMismatchError`, which the views show as a screen naming both numbers. Nothing here names a contract number.
- **The server merges; the extension does not.** An edit goes against the version the form loaded. A stale edit that collides on nothing merges on the server. A collision is where the two editors differ. The note editor sends `conflict=auto`, so the note's merge policy settles it: the body keeps both copies, the other side's text staying and this edit landing as a conflicted copy, which the save reports. The editor for any other type does not, because most types' policy lets the last writer win, which would overwrite the other side's change to the same field without a word; its collision is refused `409` with the server's current copy, which the editor shows beside the edit and saves nothing. An edit based on a version the server no longer keeps (`ancestor_unavailable`, after thinning) is refused either way and shown the same way.
- **A trashed item answers `404` by id**, by design, so anything shown for a trashed item comes from the list row.
- **Source is server-stamped** from the key, never set by the client, so everything captured here carries the key's own source.

## Configuration

Preferences carry the server URL, the API key, the type Quick Capture starts on, the tier captures land in, and the tags every capture starts with. **Sign-in is a key for now.** The server's device-code flow exists and Raycast can open a browser, so a sign-in replaces the key preference later.

**The key decides what the extension can do**, and every command works within it: a refusal names the permission missing rather than hiding the action. Content work needs write on the types, their tags and the edges a reply and an annotation draw; Delete Permanently and Empty Trash need `items.purge`. Each key has its own `source`, which the server refuses to share, so a second key for Raycast needs a source of its own.

```bash
marfa keys create --label raycast --source raycast \
  --type-permission '*=write' --metadata-permission '*=write' --edge-permission '*=write' \
  --permission items.purge
```

## Commands

- **Browse** lists every item, newest change first under the day it changed, with a type filter defaulting to notes, a state submenu (Active, Archived, Trash, All States) and a tier submenu (All Tiers, Library, Feed). An empty search bar walks the list page by page; typing hands the text to the server's full-text search, which reaches past the loaded pages and answers by relevance, without day headings. The index leaves out the Trash, so a search under All States finds nothing trashed. The search index leaves out the Trash, so there typing filters the loaded rows instead. The list is read again on every open, so a change made in another app shows the next time Browse opens, or at once with Refresh. Every row opens its detail, and carries the item's actions:
  - **Edit**: a note in its own editor, any other type in the form its schema describes (below).
  - **Reply**, a note in the item's thread as Marfa Mini threads it: an `in-thread` edge to the thread's root (the item itself, or the item a reply already points at) carrying a `position` after the last reply, drawn after the note is written since an inline edge carries no properties. **Annotate**, a highlight drawing a `references` edge to the item as it is written.
  - **Tags**, **Archive** and **Unarchive** with an undo, **Move to Trash** with an undo, **Restore**, and in the Trash **Delete Permanently** after a confirmation. The purge door takes no version, so the item is found again in the Trash first and deleted only if it is the version the person saw; one purged elsewhere meanwhile counts as done.
  - **Empty Trash** in the Trash: a dry run counts every trashed item this key may delete (a narrower key purges only types it may write, and is told what it left), the confirmation names that count, and the purge is held to it: the door takes no ids and matches again when it starts, so the Trash is counted again just before and the purge starts only when the very same items are there, with `max_items` refusing a match larger than the count. It runs as a server job the extension follows until it finishes, then reports how many went.
- **The detail** shows the item's text and picture (a stored image fetched from its blob, a thumbnail, or a cover it links to), every property in a typed sidebar, its tags, tier, state, source and version, and how many items it relates to. From it: **Show Related Items** lists the items it links to and those linking to it by edge type, read in one `bulk-get`; **Show Versions** lists the versions the server keeps before the current one. A trashed item is shown from its list row, since the server answers a trashed item only in a listing.
- **Quick Capture** captures any type, starting on the Default Capture Type, with drafts. A note keeps its own form: the body, named by its first line, and tags. Any other type gets the form its schema describes (below). Insert Clipboard Text brings the clipboard into the body.
- **Clipboard Capture** saves the clipboard without a form: a copied file as a file (an image as an image), uploaded as a blob and named by its file name; a lone web address as a bookmark; any other text as a note. The file is checked first, since a copied file also offers its name as text.
- **Clipboard Capture (Edit)** opens the same capture form seeded from the clipboard: a file starts as a file, a lone link as a bookmark, anything else as the Default Capture Type. Each field is seeded by what it is, never by type: a link into the type's one URL field (`url`, or else the first declared; a cover or a source is not the page) or the title of a type with none, a file's name into the title, the text into the body.
- **Type Registry** lists every type the server holds, with its namespace, parent and field count, and each type's fields resolved through `parent`: kind, whether required, enum values, format, and which field the type titles and bodies by.
- **Manage Keys** lists every key on the server, and mints, edits and revokes them, when the key in the preferences holds `keys.mint` or is the operator key. It reads that key first (`GET /keys/current`), and without either the command is one screen naming the permission and how to mint a key that holds it.
  - **Create** asks for a label, a source of the key's own and a default tier, and a reach: **Everything this key holds** names no map, so the server copies the creator's maps, permissions and claimed sources; **Content, read and write** copies the creator's type, tag and edge maps with no permission and no claim; **Content, read only** is the same with each `write` narrowed to `read`; **Custom** takes each map as `pattern=level` lines, the seven permissions and the claimed sources. The operator key holds no map and may grant anything, so its content presets reach `*`, and a key it mints naming nothing holds every map at `*=write` and all seven permissions. The new key is shown once, in plain text, with Copy.
  - **Edit** changes the label, tier, maps, permissions and claims, sending only what changed: a key editing another may not hold every permission that key has, and the server refuses a write naming a reach the writer lacks. A map is sent only when its text differs from the text the form started with, and a map the lines cannot show exactly (a pattern with surrounding spaces, say) is shown read-only and never sent, so the form's own tidying can never widen or narrow a key. A key's source never changes.
  - **Revoke** confirms first, and warns when the key is the one Raycast is using. An operator key is offered for revoking only to another operator key, since only an operator key can mint one. A refusal names its field where it has one, in the server's words: a source another key owns or claims, a claimed source the minting key cannot grant, or a permission it lacks; a reach it lacks is told as the server tells it (`src/keys.ts`). A key revoked elsewhere meanwhile is said to be gone, and the list is read again.
- **Status** shows the server the extension points at, the contract it speaks beside the one this build reads, and the key as the server holds it (`GET /keys/current`): its label, the source it writes as, the maps it holds and any permission beyond them. The server's description needs no key, so a refused key still shows which server refused it.

**A note is named by its first line as it reads**, without its markdown, by the rule Memos WithMarfa uses (`src/notes.ts`). A note's stored `title` is not its name: Memos WithMarfa never writes one and Marfa Mini treats it as a date stamp, so a list titled by it would disagree with every other app showing the same notes. Capture writes `body` alone for the same reason.

**Types come from the server's registry**, walked through `parent`, so a type declared beneath the note lists and edits as a note, and an instance's own types show their own labels. `GET /types` answers each type as declared, not as resolved, so `src/schema-fields.ts` resolves the fields root first, a subtype's declaration of a field replacing its ancestor's whole. Type identifiers are named only where the clipboard decides what it becomes (`core.note`, `core.bookmark`, `core.file`, `core.file.image`), for curated icons, for `core.event`'s time zone rules, and for what Reply and Annotate write (`core.note` and `core.highlight`).

**Copied HTML becomes markdown** (`src/clipboard.ts`, with turndown) wherever the clipboard fills a body: Clipboard Capture, the edit form and Insert Clipboard Text. HTML with no formatting element in it, such as code copied from an editor as colored spans or a Google Docs copy with no styling, is taken as its plain text instead, since markdown would escape every `*` and `_`. Code in a `<pre>` is fenced as its text, a table stays a table, and inlined image bytes, styles and scripts are dropped.

## The capture form

**Built from the schema, never from a list of types** (`src/capture-plan.ts`, `src/capture-values.ts`, `src/capture-form.ts`). Each field's declared type picks its control: text, a markdown area for the type's body field, number, checkbox, a dropdown for an enum, a tag picker for an array of enum values, a date or date-time picker, one entry per line for an array of scalars, JSON for an object or an array of structures, and a file picker for a `thumbnail`. A kind this build does not know falls back to JSON.

- **Order is the only importance a schema carries**: the title and body hints lead, then required fields, then the fields the form fills in itself, then optional fields in declared order. At most six optional fields show, the hints among them when optional; the rest wait behind Show More Fields, which opens by itself when a hidden field holds a value, so nothing is sent that is not on screen. A required field is never hidden, and a JSON box or a field kept out of search is always demoted.
- **The form refuses what the server would**, all at once and keyed by field: a required field left blank, a number that is not written in decimals, a URL or email that does not parse, an enum or tag value it does not list, a checkbox given anything but `true` or `false`, a date-time with a time but no zone offset (a bare day is the server's all-day shape and goes as it is), text past `maxLength`, a list past `maxItems`, and a thumbnail that is not a PNG, JPEG or WebP image of at most 16 KB. A refusal the server still sends is read from its envelope (`details.errors`) and marked on the field it names.
- **A body goes as written**, untrimmed, since an indented first line is a code block; other text is trimmed.
- **A type holds a file when it declares both `blob_ref` and `mime_type`**, inherited or not. Its form offers a file picker in place of those two fields, uploads the bytes to `POST /blobs` and names the item by the file when its title is empty.
- **A thumbnail is a data URI the item carries**, not a blob: the picked image is read, checked and encoded in the form.
- **What a schema says only in prose lives in one table per rule**, for `core.event` alone: its zones are checked, its end must follow its start, its start zone defaults to the device's and stays visible, and an end zone equal to the start is left out, since absent means the same.
- **Additional Properties** takes `key: value` lines for what a type does not declare, which the server accepts unless its strict mode names the type. A key naming an item field is refused, as the server refuses it, and so is one the type declares, which has its own checked control. A number becomes one only when it reads back the same, so `01234` stays text.
- **Every control is controlled**, so switching type keeps what was typed under the same field names, and a draft revives with the type it was written for.
- **Editing any other type uses the same controls**, filled from the item (`src/edit-values.ts`). It sends the item's whole properties with `properties_mode: replace`, because a null under a merge is dropped and replace is the only way to clear a field. The server still merges a stale replace field by field against the version read, so a change made elsewhere to a field the edit did not touch survives, and one to a field it did is refused as a collision. A rule across fields (an event's zones, its end after its start) is judged only when the edit changed one of its fields, so a stored value the server took never blocks an unrelated edit. A field counts as edited only where the form builds something other than it would for the item untouched (`baselineProperties`), so a value the controls only respell, such as a stored `false`, a trailing space, an empty list or an instant written `…00Z`, is sent back exactly as stored. Undeclared properties and a file's reference go back as they were; an empty thumbnail picker keeps the image.

**A failure that stops everything owns the screen**: another contract, an unusable URL or key, a URL that redirects or is not a Marfa server, an unreachable server and a refused key each replace the list with what to change, and a way to the preferences. Anything else is a toast over what is already there. `src/marfa.ts` checks the URL and the key before the client sees them, because a key no header can carry fails inside fetch with a message that quotes it.

## AI tools

Tools over the same door as the commands: **search-items**, which returns full rows (name, text, tags, when it changed) so the model answers without a second call; **list-items**, the most recently changed items narrowed by type, state and tier, for questions with no words to search for; **list-types**, which lists the types or describes one type's resolved fields; and **capture-item**, which writes any type through the same plan and validator as the capture form, behind a confirmation naming the type and each value, and defaults an event's zone to the device's as the form does. A tool turns a failure into the same words a view shows, so the model can pass on what to change. Instructions and evals are in `ai.yaml`.

- **Input is one object type documented with JSDoc per field**, because Raycast generates the model-facing schema from the TypeScript; the JSDoc is the instruction set.
- **An eval asserts only what the documented matcher grammar covers**, such as `includes` on a string and a dotted path into an argument (`properties.0.name`). A guessed syntax either errors or matches nothing, and one that matches nothing passes vacuously, which is worse than asserting less.

## Testing

**Automated coverage is pure logic only**: the note's name, the registry's display rules and field resolution, the capture form's plan and validation, key presets, map lines, edits and refusals, what the clipboard becomes and HTML's markdown, thumbnails, the properties an edit sends and its round trip, how the detail reads (markdown, sidebar, picture, relations), dates, following the Empty Trash job, and how a failure is sorted. All of them take values and return values. Component rendering is not harnessed and should not be; move the answerable part of a question into a pure function a test can reach instead.

- **Tests live in `test/`, not beside the source.** Lint runs over every file in the source directory, so a colocated test is a linted test.
- **A tested module never imports `@raycast/api`**, which ships types and no runtime, since Raycast injects one when it builds. Icons live in `src/appearance.ts` for that reason, apart from the registry.
- **The suite pins a time zone with an offset and a locale** (`vitest.config.mts`), so a date that assumed UTC fails here rather than for a reader west of Greenwich.
- **Manual verification against a running server decides whether a change works.** Boot one from the monorepo with `core/scripts/server-up.sh`, mint a key as above, and point the extension at it.

## Conventions

- American English throughout, scoped Conventional Commits, Prettier with single quotes at 100 characters.
- **Build outputs to `./dist/`.** Never to the repository root: that path is destructive and removes the assets directory between runs.
- **Lint runs relaxed**, which skips store-publish icon validation. Drop that flag if this is ever submitted to the store.
- Comments are self-contained and explain _why_, never referencing internal trackers or project phases.
- **Local `main`.** Once the work is merged, bring the local `main` up to date (`git pull --ff-only` on `main`) so the next piece of work starts from it.

## CI

Runs on a managed ARM runner selected by the repository's runner variable, which the workflow reads directly, so returning this repository to a local pool is a variable change and nothing else.

**A change that touches only agent instructions skips the build**: `AGENTS.md`, `CLAUDE.md`, `README.md` and `LICENSE` at the root, `docs/`, `.agents/`, `.claude/`, `.codex/`, `.githooks/`, and the issue and pull request templates. On a pull request, `scripts/ci-changes.sh` decides and a path it does not name builds. On a push, the workflow's `paths-ignore` decides. Do not add `paths` to the pull request trigger: `build` is a required check, this repository has no bypass actor, and a filtered-out workflow would leave the check pending and block the merge.

**The npm cache is enabled unconditionally**, which is correct here and worth stating because the sibling repositories condition theirs. Those are pnpm sharing a persistent store on a local pool, where caching costs more than it saves; this is npm on an ephemeral runner that keeps nothing between jobs, so there is nothing to condition on.

## Local install

The extension lives in your Raycast app rather than in this repository, after a one-time dev-mode registration: `npm install && npm run dev`, wait for the built-extension message, then stop. It stays installed and usable; stopping dev mode only loses hot reload and log streaming.

**After pulling new code**, reinstall from the lockfile if it moved, then run dev briefly so Raycast picks up the fresh build. Dev installs nothing, so skipping the install would leave the built extension running against whatever was on disk before, which is why the pre-dev guard refuses a drifted tree.
