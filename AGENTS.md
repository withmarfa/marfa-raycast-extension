# Marfa Raycast Extension

Raycast extension for browsing, searching and capturing Marfa items. Standard extension layout: npm with a committed lockfile, no workspace files.

## Build and run

```bash
npm install
npm run dev         # development mode in Raycast
npm run build
npm run lint        # ray lint --relaxed
npm run test        # vitest run
npm run typecheck   # faster signal than a build for type errors
```

Three gotchas are baked into the config and each fails quietly without them.

- **`.npmrc` carries `legacy-peer-deps=true`**, a documented workaround for a strict-peer-deps quirk in the eslint toolchain the Raycast config pulls in. Without it the install errors on a transitive devDependency.
- **The React and Node type packages are pinned to exact versions**, matching what `@raycast/api` declares. Drifting to ranges duplicates the React type tree under the API package's own modules and breaks the type check.
- **A version guard runs before typecheck, dev and build, so none of them answer against a stale tree.** CI installs from the lockfile on a fresh checkout and is therefore always right, which means nothing in CI can notice that a working copy is not. A dependency bump merged without anyone reinstalling leaves the installed tree at a different `@withmarfa/*` version from the one the lockfile resolved, and both the compiler and the Raycast build answer that wrong question silently. The guard compares installed against **resolved**, not against the declared range, which a same-range bump satisfies whether or not anyone reinstalled. The fix is a clean install.

## Configuration

Preferences carry the server URL (required, no default), an optional static API key as an escape hatch, capture defaults for tier, type and tags, and a location toggle.

**Capture location invokes a named macOS Shortcut** that must print `lat,lon` on stdout. Best-effort: a missing shortcut or a denied permission falls through silently and the capture proceeds without location.

## Auth

Implicit OAuth on first use, following the canonical Raycast pattern: every command's default export is wrapped with an access-token higher-order component over the PKCE client.

- **Endpoints and scopes come from the server, not from this repository.** The instance's authorization-server document supplies the three endpoints and the permission bundles it advertises, expanded into the scope string and cached per issuer for a day. The hardcoded paths survive only as the fallback for a server serving no document.
- **Bundles cover content, not operations.** They name item types and say nothing about edges or metadata, which this extension performs whatever content it is granted, nor about offline access, which is not a permission over data at all. A separate always-requested list is unioned in to cover both, and removing that union silently breaks tagging, the detail view's edges and the type registry itself.
- **The space permissions are unioned in from their own list, and the split is the rule rather than tidiness.** This extension asks for one, the permission to create and revoke keys, because managing keys is its whole administrative reach. It cannot come from a bundle: the server withholds space permissions from every bundle deliberately, so that granting one is always a person ticking a row rather than a side effect of accepting a group, and an extension waiting for a bundle to offer one would wait forever. It cannot go in the always-requested list either, whose defining property is being asked for unconditionally, which is the one thing a space permission must never be. Both lists reach the same request; the split preserves the reason, which is the half that survives someone adding the next entry.
- **The registration declares its scope, and a stored client id freezes it.** The server stores a ceiling from the registration body, and the authorize surface *narrows* rather than refuses, so a scope above the ceiling is dropped before the consent screen is drawn. A registration omitting its scope therefore does not fail; it caps every later sign-in at the default bundle expansion, which carries no space permission at all, and the one this extension needs goes missing between asking and consenting with nothing naming the cause.
- **What the stored client was registered claiming is recorded, and compared on every sign-in.** Nothing reads a ceiling back, so the record is the only way to know what the stored client can carry, and the comparison is the only way to notice in time. An earlier build compared it only when a caller asked for a renewal, which made the ordinary sign-in the one path that could never repair itself: an install whose client predated a widened request kept presenting a frozen ceiling and lost the scopes above it silently. **Any client requesting a space permission needs both halves.**
- **Registering again is gated on the uncovered set, not on any shortfall, and the two ditches sit either side of that.** The server catches a stale ceiling up in place for every scope its bundles publish, so the ordinary case, an operator adding a type and the bundles widening, repairs itself during the next authorize; registering for it would abandon a client row per user every time a type is added, with no route this extension can call to remove one. Space permissions are excluded from that catch-up, so an uncovered one is worth a registration and an uncovered anything-else is not. A client with no recorded claim registers too, its ceiling being unknowable. **The operation scopes unioned in unconditionally are outside the catch-up as well, and are safe only because they are constant**, so adding one is the move this gate would not protect.
- **A fallback scope set decides nothing about a ceiling.** When discovery fails and the cache has aged out the request is this repository's hardcoded list, which neither covers nor is covered by what a real instance advertises. Deciding from it re-registers on every sign-in a flapping endpoint produces, in both directions, each pass abandoning the client the last one minted, so a stored client is reused untouched and its recorded claim is left alone.
- **The session records what it was given, not what it asked for.** A completed exchange writes both, keyed by issuer, and the re-consent check compares that pair against what the server advertises now. Recording only the request is what made a narrow grant permanent and invisible: the full advertised set was written down, a subset was issued, and every launch afterwards concluded there was nothing left to ask for.
- **The rule is "has anything changed since this exact ask produced this exact answer".** Not "is the grant short of the advertisement", which never terminates when a server issues less than it advertises. Not "has the advertisement moved" either, which terminates but goes blind to a server that quietly narrows. Comparing the pair terminates and stays honest, so a scope permanently refused costs exactly one consent screen ever. A generated sweep asserts the decision reaches a fixed point within one round.
- **A refresh response that omits `scope` means "as requested", and the stored scope is carried forward.** Writing the absence through would empty it about an hour after a sign-in, and every surface that explains an absence would quietly stop being able to.
- **Coverage is the platform's question, and it is asked through `@withmarfa/shared`.** Do not reimplement the scope grammar here, however small the case looks. A local copy disagreed with the real rule on the content category, where a grant of the category reaches every type through a projection the copy had no arm for, so it reported the whole registry as unreadable to a session that could read all of it. It also treated any requirement it could not parse as covered, which is fail-open on exactly the axis where a new scope family would first appear.
- **One line is deliberately not the platform's answer: an empty or unknown grant is missing nothing.** The shared helper reports an empty grant as covering nothing, which is right for its question and wrong for this one. A token whose scopes the server did not report is not evidence of a narrow grant, and deciding from that shortfall once discarded the session on every launch and presented as signing out immediately after signing in. A test states the disagreement, so removing the guard fails rather than reading as a tidy-up.
- **A narrower grant outranks a broader one.** The request path resolves exact, then the longest matching subtree wildcard, then the global one. Returning on the first match with a sufficient verb read a broad write plus a narrow read as covering writes everywhere, which is yes where the server says no, and what reads this decides whether to tell someone their content is visible.
- **Reauthorizing sends `prompt=consent` and deliberately does not revoke.** Raycast's logout clears local tokens and cannot touch the server, so signing out and back in presents the same client against a standing grant. Revoking looks like the answer and is not: the provider's revoke marks the refresh token and deletes the access tokens beside it while touching the consent row not at all, so it signs the person out and the next authorization is waved through on exactly the grant it was meant to clear.
- **It arms the consent screen rather than opening one, because a browser redirect resolves back into a worker.** A worker belongs to a command the person is about to dismiss and Raycast is entitled to unload, so awaiting the flow in an action handler lost four consecutive consent screens on a real install. The flag is per issuer, spent only once an exchange completes, and kept rather than discarded when the Server URL changes: it is already about the server it was asked of. A pasted API key is refused outright, since none of this reaches one.

## Commands

- **Browse** is the one list over your items. **Its search bar does two things at once**, which is what let it absorb a separate search command: the native filter narrows loaded rows instantly, and the same text goes to the server as full text, so a match past the loaded pages arrives instead of reading as absent. A server hit carries the query as a keyword, without which the native filter would hide a row fetched precisely because it matched. The empty state for a type the session was not granted carries the review action, since nothing else on that screen can change the answer.
- **Quick Capture** builds its form from the type's schema. Free-form additional properties accept `key: value` lines for anything the type does not declare.
- **Manage Keys** covers list, detail, create, edit and revoke. **A browser sign-in can create a key**: the server grants that on the key permission, clamps the new key to the reach the session itself holds, and derives its permissions from the grant when the form asks for none, so "a key like this sign-in" is the no-input case. **A refusal names the permission that was missing**, and the empty state carries the review action; the decision is read from the server's own reported requirement rather than inferred from the local grant, which can be stale.
- **Clipboard Capture** reads the clipboard and routes by content: a URL becomes a bookmark, a file becomes a file item, rich text becomes a note preserving the HTML. The edit variant offers the same generated form pre-filled, with a file picker for any type declaring blob and MIME fields, which covers the file family without naming any of it.
- **Server Info** reports the instance, auth mode and identity. **Auth mode is derived from the credential, never from whether a call succeeded**: the profile route is gated on a permission a person can decline on the consent screen, so a sign-in that reads its own identity and one that is refused are the same auth mode, and reporting that refusal as a static key pointed diagnosis at the wrong preference.
- **Type Registry** lists every type the instance registers, with fields resolved through ancestry. The raw schema is a copy action rather than a view.

Only Server Info ships disabled by default. **Manage Keys already refuses a caller without the permission with a clear empty state**, which is what hiding it stood in for, and three commands nobody launched accumulated presentation defects a later pass had to go and find.

## AI tools

Four tools, three reads and one write behind a confirmation.

- **A tool has no access-token wrapper**, and whether one would work at a tool entry point is not something the documentation answers. The client factory removes the need to know: its token provider falls through to authorizing when nothing has put a token in the global, which is the ordinary path in a tool.
- **That fallback runs per request, and caching what it returns is a trap worth naming.** The SDK asks for a token on every call, so memoizing is tempting; authorizing is also the refresh path, so a memoized result is an expired token handed out for the life of the process, recovering only on restart. It short-circuits on a still-valid token, which is what makes repeating it cheap.
- **A hook guards nothing in a tool**, because a hook runs where something renders, so tools call the grant check directly. Without it a tool returns an empty list for a type the session cannot read, and a model reports the person has none of them.
- **That guard only fires when a type was named, and the tools tell the model to omit it**, so the common read had nothing checking it. The reads therefore answer with the items plus a note naming the content this session was not granted, and the instructions pass it on. It rides alongside the results rather than throwing, because the items are real: what would be wrong is calling them complete.
- **The note is computed from the stored grant and from content read scopes only.** Resolving the auth config reads the discovery document and caches it, so computing it any other way would install a newer advertisement during a search and surface a consent screen later with nothing connecting it to anything the person did. And a raw shortfall carries offline access and every write scope, so counting those told a session that had declined nothing that its results were incomplete.
- **Properties are a list of name and value pairs, not a map.** Raycast extracts a tool's schema from the TypeScript and cannot resolve a record type, which the build reports rather than shipping.
- **The write tool runs the same plan and validator the form does.** A second copy would eventually disagree about what a type requires, and an event captured by asking would carry no timezone while the same event through the form carried the device's.
- **Text reaching the validator is parsed, never coerced quietly.** A date-only string read as a `Date` is UTC midnight, which is the previous day west of Greenwich, so date text is read as calendar parts and an unreadable date is refused and named. An enum is checked against the schema's values, since a dropdown constrains a person and nothing constrains a caller.
- **A tool eval asserts only what the documented matcher grammar covers.** Nothing describes matching one element of an array, and a guessed syntax that matches nothing passes vacuously, which is worse than asserting less.

## Building a capture form

**The form comes from the type's schema, not from a branch per type.** The planner turns resolved fields into controls and the value layer turns what was typed into properties, refusing what the server would refuse. Both are pure and tested.

- **Kinds map through a total record**, so a field type the platform adds fails the build here rather than falling through to a text box. A kind this build has never heard of, which can arrive over the wire, becomes a JSON box.
- **A list is one value per line, never comma-separated**, because recurrence rules contain commas.
- **A date sends the day the person picked, in their zone.** Slicing an ISO string is the UTC day, a different day west of Greenwich after their afternoon.
- **Errors are keyed by field name.** A closed union of seven let a failure outside it fall through a bare return, so the form did nothing at all: no toast, no marked field.
- **The form's own controls are prefixed and the planner refuses a schema field using the prefix.** The platform accepts a field literally named with it, so the prefix alone guarantees nothing. Four shipped types declare a field called `tags`, which is how this was found: the tag box owned that id and the two controls split one value.
- **A field the form supplies a value for is never behind the toggle**, because a hidden control writes a value nobody chose while an untouched one writes none, and for a timezone those mean different things.
- **The toggle expands only.** Collapsing unmounts the extra controls, and an unmounted control contributes no value, so closing the section would silently discard everything typed into it.
- **The defaults table is for a caller with no control, and the form deliberately does not read it.** A dropdown must carry a selection that is one of its own options, so the form defaults every start zone to the device's. Routing the form through the table looks like the fix and is not: a type outside it would default to an empty string matching none of its options.
- **A type with no schema on this server gets the whole-payload JSON editor**, and a submit is refused while the registry is still loading, since an unarrived registry looks exactly like an unknown type.

## Displaying a type

**Display comes from the instance's registry, not from a map in this repository.** Marfa is self-hostable and instances register their own types, so a hardcoded table can only describe the types someone remembered to add.

- **Required-ness is declared two ways and both are read.** The platform accepts a top-level array and a per-field flag, normalizing the first into the second, so a current server shows only the flags. Reading only the array found none and validated nothing: every type reported requiring nothing and no capture was refused before it reached the network.
- **Walk ancestry across the fetched schema list, never through the shared package's schema lookups.** Those resolve against the vocabulary compiled into the package and cannot know what a given instance registered. The grammar helpers are instance-independent and safe to call directly.
- **Do not extend the curated appearance table to integration or publisher types.** It exists only where a distinct glyph carries recognition a label cannot, which is true of the core vocabulary and essentially nothing else; widening it buys a build check at the cost of the flexibility the resolver exists to provide.

## Server contract

- **Lifecycle** is active, archived and trashed for user-facing items; the system namespace uses its own bounded pair, and this extension only surfaces the three-state subset.
- **Tier** is stamped as library on everything this extension captures. System items have no tier, and the detail view omits the row rather than rendering a placeholder.
- **Relationships are first-class typed edges.** The item shape carries no parent, thread or about field: replying creates a thread edge and annotating creates a reference edge, and atomic edge writes ride the create call.
- **Source is server-stamped** from the credential, never set by the client.

## Testing

**Automated coverage is deliberately narrow: pure logic only.** Property classification, display resolution, the scope grammar, the re-consent decision, the client-registration decision and the capture validators are among what is covered, and all of them take values and return values, which is where every defect that has cost real time here has lived. Component rendering is not harnessed and should not be.

**What that leaves uncovered is the glue, and it is not a small gap.** Nothing tests the tools, the client or the views, so a defect in how a tool assembles its arguments or how the token provider resolves is invisible to a green suite. Both have shipped one. The lesson taken was to move the answerable part of the question into a pure function a test can reach, rather than to harness the glue.

- **Tests live in `test/`, mirroring `src/`, not beside the source.** Lint runs over every file in the source directory, so a colocated test is a linted test.
- **`@raycast/api` ships no runtime.** Its manifest declares types and no entry point, because Raycast injects the runtime when it builds, so anything importing an icon, a colour or storage as a value is unimportable under a plain Node runner. The test config aliases the package to stubs that double only what something under test imports. Types still resolve from the real package, so a stub cannot change what a source file is checked against, but the icon proxies are the part a stub cannot keep honest: a renamed member still resolves, and only the type check sees it.
- **Manual verification against a real instance still decides whether a change works.** Point the extension at staging during development.

## Conventions

- American English throughout, Conventional Commits, Prettier with single quotes at 100 characters.
- **Build outputs to `./dist/`.** Never to the repository root: that path is destructive and removes the assets directory between runs.
- **Lint runs relaxed**, which skips store-publish icon validation. Drop that flag if this is ever submitted to the store.
- Comments are self-contained and explain *why*, never referencing internal trackers or project phases.

## CI

Runs on a managed ARM runner selected by the repository's runner variable, which the workflow reads directly, so returning this repository to a local pool is a variable change and nothing else.

**The npm cache is enabled unconditionally**, which is correct here and worth stating because the sibling repositories condition theirs. Those are pnpm sharing a persistent store on a local pool, where caching costs more than it saves; this is npm on an ephemeral runner that keeps nothing between jobs, so there is nothing to condition on.

## Local install

The extension lives in your Raycast app rather than in this repository, after a one-time dev-mode registration: `npm install && npm run dev`, wait for the built-extension message, then stop. It stays installed and usable; stopping dev mode only loses hot reload and log streaming.

**After pulling new code**, reinstall from the lockfile if it moved, then run dev briefly so Raycast picks up the fresh build. Dev installs nothing, so skipping the install would leave the built extension running against whatever was on disk before, which is why the pre-dev guard refuses a drifted tree.
