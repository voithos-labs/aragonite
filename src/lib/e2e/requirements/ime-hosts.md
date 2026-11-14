# Feature: every element a composition runs in keeps one set of rules

A composition can run in a paragraph, a table cell, a code block, the gap caret between two blocks,
and the hidden element a block focused whole types into. The editor keeps one record of the
composition in progress for all of them (`browser/composition.ts`), which hears every key and input
in the editor, so each host behaves like the others. Each row compares against the same host with
the text typed instead: a composition ends the way typing does, whichever element hosts it. A
plugin's text block has its own rows in `plugins/editable-leaf-plain.md`.

## Happy paths

- A composition the browser drops (no `compositionend`), then Enter, in each host: the composed
  text is saved once, and Enter acts as it does after the same text typed. At the gap caret and on
  a block focused whole, that's a paragraph carrying the text, then an empty one after it with the
  caret in it. WebKit and Firefox only, whose IME drops at a key; Chromium's owns a key pressed
  inside it, and `ime-composition.md` holds the drop Chromium makes on its own.
  - Miss-analysis (#775): each host kept its own composing flag and asked about a drop at the
    signals it read, and the gap caret's and the whole-block host's keydown never asked, so no row
    pressed a key there after a drop.

- A composition the browser drops, then another key, at the gap caret and on a block focused
  whole: the composed text becomes a paragraph and the caret goes into it, so the key is spent
  there. A typed letter joins the composed text, as after the same text typed; Backspace and an
  arrow do nothing else, and every block the host sat beside stays. WebKit and Firefox only.
  - Miss-analysis: the only key row after a drop pressed Enter, so a letter, Backspace or an
    arrow on a block focused whole ran its own handler against the index from before the
    composed paragraph went in: the letter landed before it and Backspace deleted the block.

- The key that opens a composition, in each host and over a range across blocks, changes
  nothing: no key handler takes it, so the IME gets it. Chromium and WebKit send that key with
  code 229 and `isComposing: false`, named `Process` on Windows and the letter pressed on macOS,
  and each row sends both names on every engine. The paragraph row puts the caret beside an image,
  where a typed letter is the block's to write.
  - Miss-analysis: every key handler asked `isComposing`, which that key doesn't set, and no row
    sent it, so a letter beside an image and a letter on a block focused whole were written before
    the composition started.

- A real composition over a range that ends at a leaf's end (a table row's end, a paragraph's end
  before a fence, a list item's end before the next item) lands where a key typed over the same
  range does, in both modes: the composed text joins no block the range never reached, and where
  the typed key's place is the gap held before a fence, the composition opens its paragraph there
  too. Chromium only, whose IME runs over CDP.
  - Miss-analysis: the composition rows over a range were synthetic events in jsdom, which took a
    composition's place to be Delete's, so no row composed through a real IME at a row's end,
    where the text joined the next row's first cell.
  - Miss-analysis: the real rows ended at a table row or held a gap, so none ended at an item's
    end, where the text joined the next item.

## Edge cases

- The composed text appears exactly once in the document after the drop.

## Error cases

- The drop warns under `composition` once.
