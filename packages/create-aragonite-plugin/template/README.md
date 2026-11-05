# aragonite plugin template

A starter for an [aragonite](https://github.com/voithos-labs/aragonite) plugin. It's the party parrot from the [plugin guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide.md)'s first fifteen minutes, packaged: a `%%parrot` line renders as an animated ASCII parrot, with the rest of the line as its caption. The guide explains every line of it, so keep it open in another tab.

- [Start](#start): install it and open the playground.
- [Put it on GitHub](#put-it-on-github): the CI here runs there.
- [Make it yours](#make-it-yours): what to rename.
- [Scripts](#scripts), [CI](#ci) and [Versions](#versions): what's wired up already.
- [Publish](#publish): the first release by hand, then every release from a git tag.
- [Getting listed](#getting-listed): the plugin gallery.

## Start

This folder came out of `npm create @voithos-labs/aragonite-plugin@latest`, so install and open the playground:

```bash
npm install
npm run dev
```

The playground is `index.html` plus `dev/main.ts`: the editor with your plugin, mounted the way an app without Svelte mounts it. Edit anything under `src/` and the page reloads.

## Put it on GitHub

The CI in `.github/workflows/` runs on GitHub, so the folder wants a repository there. Make an empty one on GitHub (no README or license, this folder has both), then from the folder:

```bash
git init
git add .
git commit -m "a parrot"
git branch -M main
git remote add origin https://github.com/<you>/<your-repo>.git
git push -u origin main
```

Got the GitHub CLI? After the commit, `gh repo create <your-repo> --public --source . --push` makes the repository and pushes in one go.

Then swap `<you>/<your-repo>` in `package.json`'s `repository` for yours. npm checks it against the repository a release comes from (see [Publish](#publish)), and the plugin gallery links to it.

## Make it yours

The parrot already ships as `@voithos-labs/aragonite-parrot`, so rename before the two ever meet on one page:

- `name` in `package.json` is your folder's name. `aragonite-<name>` or `@your-scope/aragonite-<name>` helps people spot it on npm. Keep the `aragonite-plugin` keyword either way, it's how people find plugins.
- The plugin's `name` in `definePlugin`, and the kind name (`PARROT`).
- The marker your opener looks for (`%%parrot`), and the class names in `parrot.css`.
- `"private": true` in `package.json` stops an accidental `npm publish` of the parrot. [Publish](#publish) says when to delete it.
- `LICENSE` is MIT, which asks only that you keep its notice in what you copy from the template, so put your own license beside it. The parrot frames are MIT (`THIRD-PARTY-NOTICES.md`); drop that file along with the frames.

## Scripts

| Script                 | What it does                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev`          | The playground, with hot reload                                                        |
| `npm test`             | The conformance kits over every kind your plugin declares (`test/conformance.test.ts`) |
| `npm run test:e2e`     | The playground in a real browser: clicks, typing, undo (`e2e/`)                        |
| `npm run build`        | `dist/`: the plugin, its declarations, and `style.css`                                 |
| `npm run check:plugin` | `aragonite-plugin-check` over your built package, the check a plugin listing runs      |

`src/conformance.ts` is what the conformance check reads. It's published as your package's `./conformance` export, and it lists your plugin plus a profile for each container or inline kind you add ([Testing your plugin](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-testing.md#the-whole-plugin-at-once-runpluginconformance) has the profiles).

Hosts import `style.css` next to the editor's own stylesheet. Your `src/` imports the stylesheet directly, so the playground and the tests get it for free; the build pulls it out into that one file.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request. It builds, runs both test suites, then calls the editor's own plugin check as a reusable workflow, pinned to the editor release you build against. Bump that tag when you bump the editor.

`.github/workflows/release.yml` publishes a release. It sits idle until [Publish](#publish) wires it up.

## Versions

The plugin asks for the editor through a peer dependency, `^0.11.5`, so the host's copy is the one your plugin talks to. Bump the peer and the devDependency together.

The template, the plugin check and the listing are a preview until 0.12.0, since any editor release before it may break the plugin API, so rerun your CI on each one. The plugin guide's [What is stable, what is not](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide.md#what-is-stable-what-is-not) has the schedule after that.

## Publish

The first time, by hand:

1. Make an account on [npmjs.com](https://www.npmjs.com/signup), turn on two-factor authentication (npm wants it for publishing), and run `npm login`.
2. Check the name's free: `npm view <your-package-name>` should say 404. A name under your own scope, `@<your-npm-username>/aragonite-<name>`, always is.
3. In `package.json`, delete `"private": true` and check `version` (0.1.0 is a fine first one).
4. Run `npm publish`. It builds first, and `publishConfig` already makes a scoped package public, so there's no flag to remember.

Every release after that can come from GitHub with no npm token anywhere. npm trusts `release.yml` by name instead (npm calls it trusted publishing), and stamps each release from a public repository with a provenance statement saying which commit built it. Set it up once:

1. On npmjs.com, open your package's **Settings**, find **Trusted Publisher**, and pick **GitHub Actions**.
2. Fill in your GitHub user or organization, the repository's name, and `release.yml` as the workflow. Under allowed actions, tick **npm publish**, which isn't on by default.
3. Release within two days, since a configuration nothing has used yet expires after that:

```bash
npm version patch
git push --follow-tags
```

`npm version` bumps the version, commits and tags it (say `minor` or `major` instead of `patch` when it's that kind of release). The push hands the tag to `release.yml`, which runs the tests and publishes. That's every release from then on.

## Getting listed

The [plugin gallery](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-gallery.md) lists plugins people can find and trust a little more: a pull request adds your package, and the editor checks it on every release. The page says what that check means and what it doesn't.
