# Presentation modes

Part of the [plugin guide](../plugin-guide.md). The reads below come off the `EditorContext` from [One process, many editors](per-editor.md) and the two block factories, [`createContainerBlock`](container-walkthrough.md#the-component) and [`createEditableLeaf`](editable-content.md#the-editable-leaf).

**The contract: every plugin tier can learn the editor's current presentation mode and render for it.** The editor isn't permanently the marker-always source view (a **marker** is the syntax itself, the `**` around bold or the `#` before a heading, which the editor shows dimmed). A consumer can flip the editor into any of five modes, and a plugin that assumes source mode renders wrong the day its host flips the prop. What each mode looks like to a user is the [consumer guide's table](../consumer-guide.md#presentation-modes); this section is what each asks of a plugin.

Two facts about the type first. `PresentationMode` is `'source' | 'reading' | 'preview-block' | 'preview-inline' | 'live'`, and every read below reports the **effective** mode, which is the requested prop except for the moment a switch is still saving the outgoing mode's open edit. And the union **grows by addition**, so handle it non-exhaustively: read the one property your rendering depends on (does this mode paint markers, does it write bytes) and default the rest, or the next mode renders your kind wrong the day it lands.

How each tier reads it:

| Tier                       | Mode read                                                                                                                                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin instance logic      | `editor.presentationMode` on your `EditorContext` (a live getter); subscribe to the `presentationModeChange` event for flips                                                                                                                                                                   |
| Editable leaf              | `leaf.getPresentationMode()` on the `createEditableLeaf` surface                                                                                                                                                                                                                               |
| Container block (factory)  | `container.getPresentationMode()` on the `createContainerBlock` surface                                                                                                                                                                                                                        |
| Inline widget (rendering)  | The `getPresentationMode` prop your component is mounted with, a **live getter** beside the frozen `{ inline, source }` snapshot                                                                                                                                                               |
| Inline widget (editing)    | `ctx.presentationMode` on the `InlineWidgetEditingContext` your `onSelectedKey` handler receives ([Inline kinds](inline-kinds.md#inline-kinds))                                                                                                                                                |
| Block component (DOM tier) | The `data-presentation` attribute on the editor root (`el.closest('[data-presentation]')`); **absent means `'source'`**. The fallback for a component holding only a DOM handle, and the one read that isn't live ([What is live, what is point-in-time](#what-is-live-what-is-point-in-time)) |

```ts
container.getPresentationMode(); // 'reading'
leaf.getPresentationMode(); // 'reading'
el.closest('[data-presentation]')?.getAttribute('data-presentation') ?? 'source'; // 'reading' (the attribute is absent in source mode)
```

In `reading` mode the platform does most of it for you, which is why most plugins need no mode code at all:

- your editable leaf never reveals and never commits;
- chord dispatch (block commands, global commands, keymaps) is swallowed at the dispatcher;
- the container factory gates whole-block Enter and Backspace;
- marker spans hide by CSS.

You read the mode yourself in two cases: when your component owns an edit affordance of its own (a toolbar button, a click-to-edit swap, an interactive widget) which must go inert, the bundled mermaid block's Edit button and the details disclosure being the worked examples, or when your rendering should genuinely differ between a source view and a reading view.

`preview-block` is different: it's a **live editing** mode, so none of those reading gates fire. You type, edit, and command in it exactly as in source; only the marker visibility changes. A **render-primary** plugin block (the quickstart parrot, [the render-primary recipe](render-primary.md#recipe-a-render-primary-block)) gets this for free, since it already shows its picture until the caret enters. A plugin block that instead renders always-visible source chrome should hide that chrome when it isn't the focused block. There's no "am I the focused block" signal to read, so the render-primary pattern is the supported way to get there.

`preview-inline` narrows the reveal to the construct under the caret, inside the focused block. For plugin inline kinds nothing changes at the API level:

- **A registered inline widget** keeps its editing policy exactly as in every other live mode (`revealSource` still opens the source on caret entry).
- **A recognized but unwidgeted inline kind** renders as its raw source text, the same as in source mode. If you want rendered-until-touched behavior, register it as a widget with `revealSource`.

`live` asks nothing new of you: render for it as you render for `preview-block` (hide your own source chrome) and edit in it as you edit in source.

## What is live, what is point-in-time

**The live reads.** The `EditorContext` getter, both factories' `getPresentationMode()` and the inline-widget prop are reactive, so a read inside a `$derived` or an effect re-runs on a switch. The bundled mermaid and details blocks both do exactly that: `$derived(getPresentationMode() === 'reading')` off the container factory.

**The block-component DOM read is point-in-time.** `closest()` learns the mode when your code runs, but a live flip does **not** re-render a mounted block through it. A component holding only a DOM handle has to react explicitly: subscribe to `presentationModeChange` on your `EditorContext`'s `events` (from `onEditor`) and update from the handler, or re-read the attribute at each gesture.

**The theme rides exactly where the mode rides.** `EditorContext.theme` (paired with the `themeChange` event), the container and leaf factories' `getTheme()`, and the inline-widget `getTheme` prop are the same four routes with the same liveness. The theme is never missing (the editor defaults to `'dark'`), so call `getTheme()` as is. Reach for it only when your content's colors are painted by an engine CSS can't reach; token-styled chrome rethemes itself through the cascade.

**Reading mode writes no bytes, which isn't the same as "nothing happens".** An affordance whose flip is view-only may stay live there: the built-in `<details>` disclosure lets a reader open a collapsed section. An affordance whose flip would rewrite the document (a task checkbox) stays inert. If you build the view-only kind, copy the disclosure's pattern:

- Keep the open/closed state in a module that can't commit at all, and pick the click handler by mode.
- Feed the state the view actually shows to the container factory's `isCollapsed` dep, so the editor mounts what the view claims is open.
- Reset that state when the mode leaves reading.

**Check the mode you handle.** Gate on the specific mode you render for (`=== 'reading'` for a reading affordance), never a `'source'` check you invert: `preview-block` is a live editing mode, so a reading-style gate must not fire in it, and a future mode then falls back to your default rendering.
