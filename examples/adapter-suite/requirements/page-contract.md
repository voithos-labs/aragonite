# Feature: the editor inside a framework app

Every app in `examples/` that wraps the editor for a framework renders one page, found by test id:
the editor (holding a two-line note), a `mirror` of the value the app holds, a `load` button that
swaps in a second note, a `load-long` button that swaps in 300 paragraphs (`host-fill.md`), in the example apps a
`load-code` button that swaps in two code fences (`highlight.md`), a `revert` button that goes back to the last loaded note, a `theme` toggle, a `drop-theme` toggle that
stops passing the theme at all, an `unmount` toggle, a `read` button that copies the editor handle's
document into `read-out`, the `framework-version` the page runs on, and a `header-input` inside the
editor's header. `?uncontrolled` renders the editor from `defaultValue` instead of the bound value.
Every scenario fails on any console error, page error, aragonite dev warning or Vue warning.

## Happy paths

- Typing in the editor: the mirror shows the new text.
- Typing a sentence at full speed: every key lands, in order, in both the editor and the mirror.
- Load after typing: the editor and the mirror show the second note, and undo then changes nothing.
- Revert after typing: the editor and the mirror show the loaded note again.
- Theme toggle: the editor's theme flips at once, and undo still takes back typing from before it.
- Read after typing: the read-out shows the typed document, through the handle the wrapper exposes.

## Edge cases

- Drop theme: the editor goes back to its default theme (dark), and passing it again brings the light theme back.
- The page has no CSS reset of its own, as a new app starts: after typing, the editor still ends inside its container and the page is no wider than the viewport, not scrolled sideways.
- Typing in the header input: the input keeps every key, Backspace included, and the document doesn't change.
- Unmount: no editor and no header input are left on the page; mounting again shows the value the app holds.
- Unmount, mount and unmount again: the window and document hold the same listeners as after the first unmount, so the wrapper destroyed the editor and didn't just drop its element.
- One editor on the page, in a dev build too (React's StrictMode mounts the component twice there).
- Uncontrolled: the editor starts on its default note, typing still reaches the mirror, and a re-render (the theme toggle) keeps the typed text.
- The page runs on the framework version its project names, so the React 18 and Vue 3.3 projects really test those versions.

## Vue

- No boolean option passed: Mod+F in the editor opens the find bar, so an absent boolean keeps the editor's default instead of Vue's `false`.
- `?bare-boolean`: the editor gets `search-bar` as a bare attribute, and Mod+F opens the find bar, so the wrapper declares each boolean option `Boolean` (any other declaration hands the editor `''`).
- `?shared-plugin`: four editors share one plugin. The first three get it out of reactive state (the reactive list itself, a list filtered from it, and `{ plugin }` entries mapped from it), the last as imported. All four mount with no "already installed" warning, since the wrapper hands the editor the object behind each Vue proxy, the list's entries included. Miss: the old page only passed the reactive list itself, so a top-level `toRaw` passed it while a filtered list still handed over proxies.

## Server rendering (Next, Nuxt)

- The page renders on the server with no editor in it (the editor mounts in the browser), and hydrates with no hydration warning.
- Next: a server component can render the wrapper directly, since the wrapper marks itself a client component.
