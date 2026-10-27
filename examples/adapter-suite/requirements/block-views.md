# Feature: plugin blocks drawn by the app's own framework

The React and Vue example apps serve a second page at `?block-views`: an editor whose plugin draws
three blocks with the app's own components (`reactBlockView` or `vueBlockView`), on the editor the
app installed, which for these apps is the prebuilt copy. The blocks are a memo line (`%% `, a
leaf whose text is always editable, with a badge beside it), a click-to-edit label (`@@ `, shown
as plain text until a click opens its source) and a box (`:::box`, a container with a badge and
its child blocks). A `load` button swaps in a second document, `load-long` swaps in the first one
with three hundred paragraphs after it, an `unmount` toggle removes and restores the editor, and a
`mirror` shows the value the app holds. The editor scrolls inside a box of its own, so a long
document windows: only the blocks near the viewport are mounted. The page's inline chip and memo
badge are `plugin-views.md`'s. Every scenario fails on any console error, page error or console
warning, not only the editor's own.

## Happy paths

- The page loads with the blocks in its first document: each draws its framework's badge, the
  memo shows its text, the label its caption, and the box its child. The memo's badge text comes
  from the app's context (React's `wrap` provider, Vue's app-level `provide` through the `app`
  option), so a block component sees what the app provides.
- Typing at the end of the memo reaches the mirror; Ctrl+Z takes it back.
- A click on the label opens its source with the caret in it; End and typing edit it, and clicking
  into the paragraph below commits the edit once. One Ctrl+Z restores the old label whole.
- With the label open, a preview beside its source follows each key typed and each Backspace
  (the component's `draft`) while the mirror stays unchanged; clicking away commits, folds the
  label and removes the preview.
- Typing in the box's child, then Enter and more typing, lands inside the box; Ctrl+Z takes the
  last typing back. The box's `BlockChildren` carries an attribute that changes with each edit, so
  it re-renders as the child is typed in. Miss: a Vue element ref runs again on every re-render
  with the same element, and the editor remounted children handed the box they were already in,
  losing the caret; the box had no attribute that changed, so nothing re-rendered it.

## Edge cases

- Typing a sentence at full speed into the memo keeps every key, in order. Miss: an element
  handed over by a ref callback that changes between renders is handed back first, and the editor
  empties an element handed back, so the text would vanish mid-typing.
- The click on the label leaves no warning: the source element arrives inside the update that
  opens it, so the caret lands at once. Miss: Vue re-renders after a state change a microtask
  later, after the editor has checked; only the dev projects, with dev checks on, could see it.
- Loading another document from a click destroys the old views and draws the new one, which
  takes typing.
- Scrolling the long document until the memo unmounts, then back, mounts the blocks again with
  fresh views; the box shows its child and the memo takes typing.
- Unmounting the editor destroys every view inside the framework's own unmount, and mounting it
  again draws working blocks. Miss: React refuses a root unmounted during its own commit, which
  only an unmount driven by the app shows.
