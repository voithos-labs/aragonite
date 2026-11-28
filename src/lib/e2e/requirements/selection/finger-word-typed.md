# Feature: Typing over a long-pressed word

A long press or a double tap makes the word the editor's own selection. Typing or composing over it
writes what typing over the same word selected with a mouse writes: the block's own write, its
markers kept. Every row runs on a touch screen in Chromium.

## Happy paths

- Double tap the text of `# head` and type `Q`: `# Q`, the heading kept, in source and live mode.
- Double tap the text of `a **bold** c` in live mode and type `Q`: `a **Q** c`, the bold kept.
- Double tap the text of `heading` over a `====` underline and type `Q`: `Q` over the underline,
  still a heading, in source and live mode.

## User interactions

- Double tap the text of `# head` in live mode and compose `か`, committing `漢`: `# 漢`.

Miss-analysis: the finger's word was only typed over on a plain word, where removing it first and
typing after lands the same, and no row typed over a whole text inside markers.
