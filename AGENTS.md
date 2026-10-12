# Marfa for Raycast

A Raycast extension for capturing to a Marfa server and browsing what every app wrote there. It talks to the server over HTTP through `@withmarfa/client`, the TypeScript client generated from the server's API document. There is no local copy and no sync.

## Instruction files

- Before changing `src/`, read `src/AGENTS.md`: the server, edits, the capture form, and keys.
- Before changing `src/tools/` or `ai.yaml`, read `src/tools/AGENTS.md` as well.
- Each `AGENTS.md` has a `CLAUDE.md` symlink beside it, because Claude Code reads only `CLAUDE.md` where one exists in or above its working directory. Edit the `AGENTS.md`, never the link.
- `ray lint` runs Prettier over every file in `src/`, Markdown included. Run `npx prettier --write` on a nested `AGENTS.md` after editing it.

## Conventions

- Use American English, scoped Conventional Commits, and Prettier with single quotes at 100 characters.
- Work on a branch and reach `main` through a pull request. After a merge, run `git pull --ff-only` on `main`.
- A comment says why, never what the code says, and names no tracker or project phase.
- Use npm with the committed lockfile. There are no workspace files.

## Layout

- `src/`: the commands (`browse.tsx`, `quick-capture.tsx`, and the rest named in `package.json`), their views in `src/components/`, and pure modules beside them. `src/marfa.ts` is the one door to the server.
- `src/tools/`: the AI tools. `ai.yaml`: their instructions and evals.
- `test/`: Vitest tests, outside `src/` because `ray lint` lints every file there.
- `scripts/`: the `@withmarfa/*` version guard and the CI change classifier.
- `assets/`: the extension's icon, which the build packages.

## Commands

```sh
npm install
npm run dev         # development mode in Raycast
npm run typecheck   # tsc, faster than a build for type errors
npm run lint        # ray lint --relaxed: ESLint and Prettier
npm test            # vitest run
npm run build       # ray build -o ./dist
```

- Build only to `./dist/`. A build to the repository root deletes `assets/`.
- Lint runs `--relaxed`, which skips the store's icon checks. Drop the flag if the extension is ever submitted to the store.
- `@types/react` and `@types/node` are pinned to the exact versions `@raycast/api` declares. A range duplicates the React types under the API package and breaks the type check.
- A guard runs before `typecheck`, `dev`, `test`, and `build` and fails when an installed `@withmarfa/*` package differs from the version `package-lock.json` resolved. The fix is `npm ci`. CI always installs clean, so only this guard catches a stale local tree.

## Testing

- Automated tests cover pure logic only: values in, values out. Do not harness component rendering; move the part worth testing into a pure function.
- A tested module never imports `@raycast/api`, which ships types and no runtime. Icons live in `src/appearance.ts`, apart from the registry, for that reason.
- `vitest.config.mts` pins a time zone with an offset and a locale, so a date that assumes UTC fails here.
- A change works only once it is run against a real server. Boot one from the monorepo with `core/scripts/server-up.sh`, mint a key, and point the extension's preferences at it.
- A key for Raycast needs a source of its own, which no other key may share. Content work needs write on types, tags, and edges; Delete Permanently and Empty Trash need `items.purge`:

  ```sh
  marfa keys create --label raycast --source raycast \
    --type-permission '*=write' --metadata-permission '*=write' --edge-permission '*=write' \
    --permission items.purge
  ```

## Local install

- `npm install && npm run dev` registers the extension with Raycast once. Stop dev mode after the build message; the extension stays installed, without hot reload and log streaming.
- After pulling, run `npm ci` if the lockfile moved, then run dev briefly so Raycast picks up the new build. Dev installs nothing, which is why the guard refuses a stale tree.

## CI

- `build` runs typecheck, lint, tests, build, and the classifier's own test on the runner the repository variable `CI_RUNNER` names.
- `build` is a required check. On a pull request, `scripts/ci-changes.sh` skips it when every path is root `AGENTS.md`, `CLAUDE.md`, `README.md`, or `LICENSE`, `docs/`, an agent directory, or a GitHub template; any other path builds. On a push, the workflow's `paths-ignore` decides. Never add `paths` to the pull request trigger: the check would stay pending and block the merge.
- The npm cache stays on unconditionally. The runner keeps nothing between jobs, unlike the pnpm repositories, which condition theirs.

## Versions and releases

- There is no release process. Nothing tags, publishes, or submits the extension; it is installed through dev mode.
- `@withmarfa/client` is pinned to an exact version. Move it with `package.json` and `package-lock.json` together, then fix what the new client's types reject.

## Code Review Rules

Report only a problem you can show: name the input, state, or step, and what goes wrong. Leave formatting and lint to CI. `src/AGENTS.md` and `src/tools/AGENTS.md` add rules for their code.

- **Raycast in a tested module.** Flag a module under test that imports `@raycast/api`, directly or through another module.
- **Untested logic in a view.** Flag a decision about data, such as what to send or how to read a refusal, written inside a component where no test can reach it.
- **Dates assuming UTC.** Flag date handling that reads or writes a local day or time without the zone.
- **Guard or pins weakened.** Flag a change that skips the version guard, loosens the pinned type packages, or builds anywhere but `./dist/`.
- **Stale instructions.** Flag a change that leaves an `AGENTS.md` or a comment untrue, and fix it in the same pull request.
