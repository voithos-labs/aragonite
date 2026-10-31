# aragonite plugin template

A starter for an [aragonite](https://github.com/voithos-labs/aragonite) plugin. It's the party parrot from the [plugin guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide.md)'s first fifteen minutes, packaged: a `%%parrot` line renders as an animated ASCII parrot, with the rest of the line as its caption. The guide explains every line of it, so keep it open in another tab.

## Start

Fetch the template at the tag of the editor release you're building against, then install and open the playground:

```bash
npx degit voithos-labs/aragonite/templates/plugin#v0.11.4 my-plugin
cd my-plugin
npm install
npm run dev
```

The playground is `index.html` plus `dev/main.ts`: the editor with your plugin, mounted the way an app without Svelte mounts it. Edit anything under `src/` and the page reloads.

## Make it yours

The parrot already ships as `@voithos-labs/aragonite-parrot`, so rename before the two ever meet on one page:

- `name` in `package.json`: `aragonite-<name>`, or `@your-scope/aragonite-<name>`. Keep the `aragonite-plugin` keyword, it's how people find plugins on npm.
- The plugin's `name` in `definePlugin`, and the kind name (`PARROT`).
- The marker your opener looks for (`%%parrot`), and the class names in `parrot.css`.
- `"private": true` in `package.json` stops an accidental `npm publish` of the parrot. Delete it when your plugin is ready.
- `LICENSE` is 0BSD, which asks nothing of you, so put your own license there. The parrot frames are MIT (`THIRD-PARTY-NOTICES.md`); drop that file along with the frames.

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

`.github/workflows/ci.yml` builds, runs both test suites, then calls the editor's own plugin check as a reusable workflow, pinned to the editor release you build against. Bump that tag when you bump the editor.

## Versions

The plugin asks for the editor through a peer dependency, `^0.11.4`, so the host's copy is the one your plugin talks to. Bump the peer and the devDependency together.

From 0.12.0 the editor's plugin API can break only in a minor release until 1.0, and only in a major one after, so a `^` range on the release you tested against is honest. The template, the plugin check and the listing are a preview until 0.12.0, since the plugin API under them can still break in any 0.11 release. Rerun your CI on each editor release until then.

## Getting listed

The [plugin gallery](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-gallery.md) lists plugins people can find and trust a little more: a pull request adds your package, and the editor checks it on every release. The page says what that check means and what it doesn't.
