# Extension source

Rules for the commands, views, and pure modules in `src/`. The root `AGENTS.md` still applies, and `src/tools/AGENTS.md` adds the AI tools.

## The server

- `marfa.ts` is the one door to the server. Every call there returns what the server answered or throws, so a view never reads an error out of a successful value. Call the server nowhere else.
- `marfa.ts` checks the URL and key before the client sees them, because a key no header can carry fails inside `fetch` with a message that quotes it.
- The client checks the contract and throws `ContractMismatchError` on a mismatch. Name no contract number here.
- The server stamps `source` from the key. Never send one.
- A trashed item answers `404` by ID, so anything shown for a trashed item comes from its list row.
- A failure that stops everything (another contract, an unusable URL or key, a redirect or a server that is not Marfa, an unreachable server, a refused key) replaces the view with what to change and a way to the preferences. Anything else is a toast. `failure.ts` sorts them.
- A refusal names the missing permission. Never hide an action because the key might lack it.

## Edits

- The server merges; the extension never does. Every edit goes against the version the form loaded, through `editRequest` in `requests.ts`.
- The note editor settles a collision (`conflict=auto`): a note's body keeps both copies, and the save reports the conflicted copy. No other type's editor does, because most types let the last writer win, which would overwrite the other side's change without a word. Their collision, and an `ancestor_unavailable` refusal, is shown beside the edit with the server's current copy, and nothing is saved.
- Editing any type but a note sends the whole properties with `properties_mode: replace`, the only way to clear a field. A field counts as edited only where the form builds something other than it would for the untouched item (`baselineProperties`); every other value goes back exactly as stored, as do undeclared properties and a file's reference. An empty thumbnail picker keeps the image.
- A rule across fields, such as an event's end after its start, is checked only when the edit changed one of its fields.

## Deleting

- Delete Permanently finds the item again in the Trash and deletes it only if it is the version the person saw. One purged elsewhere meanwhile counts as done.
- Empty Trash counts with a dry run and confirms that count. Just before purging it counts again and starts only when the same items are there (`sameIds`), and it sends `max_items` equal to the confirmed count.

## Notes and types

- A plain `core.note` is named by its first line as it reads, without Markdown (`noteTitle` in `notes.ts`), as Memos WithMarfa names it. Never name a plain note by its stored `title`, and capture writes its `body` alone.
- Behavior follows the registry, walked through `parent`, so a type beneath `core.note` uses the note editor. Its title follows the resolved `title_field` when present, then the first line of its body. `GET /types` answers each type as declared; `schema-fields.ts` resolves fields root first, a subtype's field replacing its ancestor's whole.
- Name a type identifier only for the note, the clipboard's choices, icons, `core.event`'s zone rules, and what Reply and Annotate write.

## The capture form

- Build the form from the type's schema, never from a list of types (`capture-plan.ts`, `capture-values.ts`, `capture-form.ts`). A field kind this build does not know falls back to JSON.
- Send nothing that is not on screen. A hidden field that holds a value opens Show More Fields, and a required field is never hidden.
- The form refuses what the server would, all at once and keyed by field. A refusal the server still sends is read from `details.errors` and marked on its field.
- Send a body untrimmed, since an indented first line is a code block. Trim other text.
- A type holds a file when it declares both `blob_ref` and `mime_type`, inherited or not. A thumbnail is a data URI the item carries, not a blob: a PNG, JPEG, or WebP image of at most 16 KB.
- A rule a schema states only in prose lives in one table per rule, for `core.event` alone.
- Additional Properties refuses a key that names an item field or a field the type declares. A value becomes a number only when it reads back the same, so `01234` stays text.
- Create Item starts from the selected text, when the Selected Text preference is on (the default), and blank otherwise (`capture-source.ts`, with `selectionSnapshot` in `clipboard.ts`). The clipboard never starts a form by itself: Fill from Clipboard reads it when the person asks, and Insert Clipboard Text adds its text to the body. A selection carries text alone, so it starts a note or a bookmark even while a file is copied. A saved draft replaces the selection. Nothing is saved until the person submits the form.
- A stored image is drawn from a file, never a data URI: `use-image.ts` fetches it into `previews/` under `environment.supportPath`, named by its hash (`image-file.ts`), and the markdown names that file (`image-preview.ts`). A photo inlined as a data URI stalls Raycast's window. A list fetches only the selected row's picture.
- Copied HTML becomes Markdown (`clipboard.ts`, with turndown). HTML with no formatting element is taken as plain text, since Markdown would escape every `*` and `_`.

## Keys

- Manage Keys works only with a key that holds `keys.mint` or `keys.manage`. The server decides what each reaches: `keys.mint` the keys within its own reach, `keys.manage` every key, narrowing only. Never hide an action on a guess about that.
- An edit sends only the fields that changed (`changedKeyFields`), because the server refuses a write naming a reach the writer lacks. A map is sent only when its text changed, and a map the lines cannot show exactly is read-only (`mapIsEditable`), so the form never widens or narrows a key. A key's source never changes.
- Show a new key once, and warn before revoking the key Raycast uses.

## Code Review Rules

- **Collision overwritten.** Flag an edit that settles a collision for a type other than a note, is not sent against the version loaded, or merges in the client.
- **Untouched value rewritten.** Flag an edit that sends a field the person did not change in any form but the stored one.
- **Purge wider than confirmed.** Flag a permanent delete or purge without the version check, the recount, or `max_items`.
- **Note misnamed.** Flag a plain `core.note` named by its `title`, a note subtype that ignores its resolved `title_field`, or a capture that writes a plain note's `title`.
- **Key widened.** Flag a key edit that can send a map or permission the person did not change.
- **Hidden or unchecked value.** Flag a form path that sends a value not on screen, or skips a check the server makes.
- **Key exposed.** Flag an error path that can show or log the API key.
