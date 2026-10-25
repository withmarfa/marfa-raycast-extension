# Marfa for Raycast

A [Raycast](https://www.raycast.com/) extension that captures notes and other items to a Marfa server and browses what every app wrote there. It talks to the server over HTTP through `@withmarfa/client`, so it keeps no local copy and does no syncing. Every command needs a reachable server.

## Requirements

- Raycast on macOS.
- A Marfa server that you can reach from your Mac.
- An API key for that server. Mint one for Raycast with the `marfa` command line:

  ```sh
  marfa keys create --label raycast --source raycast \
    --type-permission '*=write' --metadata-permission '*=write' --edge-permission '*=write' \
    --permission items.purge
  ```

  The key decides what the extension can do. Capturing and editing need write access to types, tags, and edges. Delete Permanently and Empty Trash also need the `items.purge` permission, and Manage Keys needs the `keys.mint` permission or the operator key. When the key lacks a permission, the extension names the missing one. Each key has a source of its own, so a second key for Raycast needs a different `--source`.

## Configuration

Set these in the extension's preferences in Raycast.

| Preference           | Required | Description                                                                                               |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| Server URL           | Yes      | Where your Marfa server answers, such as `http://127.0.0.1:8602`.                                         |
| API Key              | Yes      | The key minted for Raycast.                                                                               |
| Default Capture Type | No       | The type Quick Capture starts on, as a type identifier. Defaults to `core.note`.                          |
| Default Tier         | No       | Where captures land: the library keeps what you chose to keep, and the feed holds what arrives in volume. |
| Default Tags         | No       | Comma-separated tags that every capture starts with.                                                      |

## Commands

| Command                  | What it does                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Browse                   | Browse and search your items. Open, edit, tag, archive, reply to, annotate, trash, or delete them.       |
| Quick Capture            | Capture a note, or any type the server holds, in a form built from its schema.                           |
| Clipboard Capture        | Capture the clipboard at once: a file, an image, a link as a bookmark, or text as a note.                |
| Clipboard Capture (Edit) | Shape the clipboard in a capture form for any type before it is saved.                                   |
| Type Registry            | List every type the server holds and the fields each one declares.                                       |
| Manage Keys              | List, mint, change, and revoke the server's API keys. Needs a key with `keys.mint`, or the operator key. |
| Status                   | Check the server, its contract, and the API key.                                                         |

## The capture form

Quick Capture and Clipboard Capture (Edit) build their form from the type's schema on the server, so a type that an instance registers gets a form without any change to the extension. Each field's declared type picks its control, such as text, a Markdown area for the body, a dropdown for an enum, or a date picker. Required fields always show, and the optional ones beyond the first few wait behind a **Show More Fields** option. The form refuses what the server would refuse, such as a blank required field or a malformed URL, and marks the field. A note has a simpler form: its text, whose first line names the note, and its tags. Quick Capture keeps a draft when you close the form.

## AI tools

In Raycast AI, mention `@marfa` to use these tools. Instructions and evals are in `ai.yaml`.

- **Search Items:** full-text search across your items, returning each item's name, text, and tags.
- **List Items:** your most recently changed items, newest first, narrowed by type, state, or tier.
- **Capture Item:** save an item of any type the server holds. It asks you to confirm the type and each value first.
- **List Types:** list the types the server holds, or describe one type's fields and which are required.

## Build and run locally

```sh
npm install
npm run dev         # development mode in Raycast
npm run typecheck   # type check
npm run lint        # ESLint and Prettier
npm test            # unit tests
npm run build       # build into ./dist
```

Running `npm run dev` once registers the extension with Raycast. You can stop dev mode after the build message, and the extension stays installed without hot reload. Contributors and coding agents: see [AGENTS.md](AGENTS.md).

## License

MIT. See [LICENSE](LICENSE).
