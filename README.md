# Marfa for Raycast

Capture to your own Marfa, and browse everything your apps keep there, from Raycast.

## What is Marfa?

Marfa is **a data layer that you run yourself**.

- **One place for your data.** Your notes, tasks, bookmarks, files, and anything else you choose to store live in one server that you own.
- **Typed items.** Each item has a type, such as a note or a task, and the type says what the item holds.
- **Shared by your apps.** The apps you allow read and write the same items, so **your data stays put when you change apps**.
- **Yours.** The server runs on your own computer, or on one you choose, and your data stays there.

Marfa is early software. Expect breaking changes until version 1.0. To learn more, see the [Marfa docs](https://docs.marfa.so).

## What does this extension do?

Marfa for Raycast is one of those apps. Use it as a client for the Marfa you already run, or as a place for your notes in Raycast, with Marfa behind it.

- **Capture** the text you have selected, or your clipboard, to Marfa with one hotkey. Add tags, and choose where it lands.
- **Create** a note, or an item of any type your server holds, in a form built from that type.
- **Browse and search** your items. Open, edit, tag, archive, reply to, annotate, trash, or delete them.
- **Look up** the types your server holds, and manage its API keys.
- **Ask Raycast AI** to search, list, and capture items. Mention `@marfa`.

The extension keeps no copy of your data, so every command needs a server it can reach.

## Set up

### 1. Get a Marfa server

Skip this step if you already run Marfa.

On a Mac with Docker or OrbStack, run these commands in Terminal:

```sh
brew install withmarfa/tap/marfa
marfa server install
```

Open the link that the second command prints, and choose an email and password. That makes you the owner of your server. To run Marfa somewhere else, see [Deploy](https://docs.marfa.so/guides/deploy).

### 2. Make a key for Raycast

A key tells Marfa what an app may do. On your server's web page, open **API keys** and choose **Create key**. Name it `Raycast`, and give it the source `raycast`. Turn on read and write for all types, tags, and edges. To let Raycast delete items for good, also allow permanent deletes. Copy the key, because the page shows it once.

### 3. Connect Raycast

Open any Marfa command, and enter the **Server URL** and the **API Key**. If you installed Marfa on this Mac with the steps above, the Server URL is `http://localhost:8600`, unless the install printed another port.

## Commands

| Command       | What it does                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Quick Capture | Capture the text you have selected, or your clipboard, in a form. A copied file or image becomes a file. |
| Create Item   | Create a note, or an item of any type your server holds, in a form built from the type.                  |
| Browse        | Search your items. Open, edit, tag, archive, reply to, annotate, trash, or delete them.                  |
| Type Registry | See every type your server holds and the fields each one declares.                                       |
| Manage Keys   | List, make, change, and revoke API keys. Needs a key that holds `keys.mint` or `keys.manage`.            |
| Status        | Check your server, its contract, and your API key.                                                       |

## Preferences

| Preference           | Required | Description                                                                             |
| -------------------- | -------- | --------------------------------------------------------------------------------------- |
| Server URL           | Yes      | Where your Marfa server answers.                                                        |
| API Key              | Yes      | The key you made for Raycast.                                                           |
| Default Capture Type | No       | The type that Create Item and Quick Capture start on. The default is `core.note`.       |
| Default Tier         | No       | Where captures land: the library keeps what you chose to keep, the feed holds the rest. |
| Selected Text        | No       | Quick Capture starts from the selected text when there is some. On by default.          |
| Default Tags         | No       | Tags that every capture starts with, separated by commas.                               |

## FAQ

### Do I have to run Marfa myself?

Yes. Marfa isn't a hosted service. You run the server on your own computer, on a home server, or on a host such as Railway. See [Deploy](https://docs.marfa.so/guides/deploy).

### Where is my data?

On the machine that runs your Marfa server. The extension keeps no copy.

### Can I use the extension away from home?

Yes, if your Mac can reach the server. Marfa can be reached over your home network, over a private network such as Tailscale, or through a Cloudflare Tunnel. The Server URL is whatever address your Mac uses to reach it.

### Does it work offline?

No. Every command asks your server, so a command fails when the server is unreachable. Status shows what is wrong.

### What can the key do?

Only what you gave it. The extension tells you which permission is missing when Marfa refuses something. To delete items for good, the key needs the permission for permanent deletes. To change the key, use the **API keys** page, or Manage Keys with a key that is allowed to.

### Which types can I capture?

Any type your server holds. The form is built from the type, so a type you add later gets a form with no change to the extension. See Type Registry for the types and fields.

### Is it safe to try?

Marfa is early software, so keep a backup of anything that matters. See [Back up and restore](https://docs.marfa.so/guides/back-up-and-restore).

### Does it work on Windows?

No. The extension supports macOS only.

## License

MIT. See [LICENSE](LICENSE). To work on the extension, see [AGENTS.md](AGENTS.md).
