# @voithos-labs/aragonite-spellcheck

Spell check for [aragonite](https://github.com/voithos-labs/aragonite): misspelled words get a red wave, and the fixes are a right-click away.

## What it does

- A misspelled word in prose gets a red wave under it. Words in code spans, link destinations, raw HTML and code blocks are never checked, and neither are single letters, words with digits or underscores, or camelCase.
- The word you're typing stays plain until the caret leaves it, so a half-typed word never flashes red.
- Right-click a misspelled word and its suggestions lead the menu, with a divider before the usual rows. Picking one rewrites that word as one undo step.
- Select exactly the word and the selection toolbar grows a "Spelling" row, whose flyout has the same suggestions.
- Rest the pointer on a misspelled word for a moment (800 ms) and a card with its suggestions opens under it. A pointer just passing over opens nothing. The card stays while the pointer moves onto it, and closes once the pointer has left both the word and the card (after 300 ms).
- "Add to dictionary" shows only when something keeps the words a user adds (see below).
- While the plugin runs, the browser's own spell checker is off on the editor's prose, so no word gets two underlines.

The built-in dictionary is SCOWL's en_US word list. It loads the first time a word is checked (about 200 KB gzipped, in a chunk of its own), and suggests up to five fixes. Accents are ignored (`café` reads as `cafe`), and a word with no Latin letters in it is never flagged.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-spellcheck
```

The package's version should match the editor's.

## Use it

```ts
import { spellcheckPlugin } from '@voithos-labs/aragonite-spellcheck';

const plugins = [spellcheckPlugin];
```

Hand `plugins` to the editor. That's the whole setup for the waves and the menus. On React, Vue or plain JS, import `@voithos-labs/aragonite-spellcheck/style.css` beside the editor's stylesheet, since the wave lives in that file.

### Keeping added words

The editor never stores a word on its own. Pass the words you saved and a function that hears each new one, and "Add to dictionary" shows up:

```ts
spellcheckPlugin({
	words: savedWords, // accepted beyond the dictionary
	onAddWord: (word) => saveWord(word) // called with each word a user adds
});
```

Leave `onAddWord` out and there's no "Add to dictionary", since nothing would keep the word. If your app has nowhere better, `localStorageWords(key)` keeps them in the browser's localStorage:

```ts
import { localStorageWords, spellcheckPlugin } from '@voithos-labs/aragonite-spellcheck';

spellcheckPlugin(localStorageWords('my-notes:spelling'));
```

### Sharing a dictionary, or bringing your own

Each editor makes its own English dictionary unless you pass one. Pass the same one to two editors and a word added in one stops being flagged in both:

```ts
import { englishDictionary, spellcheckPlugin } from '@voithos-labs/aragonite-spellcheck';

const dictionary = englishDictionary({ words: savedWords, onAddWord: saveWord });
const plugins = [spellcheckPlugin({ dictionary })];
```

With `dictionary` passed, `words` and `onAddWord` go to that dictionary, not the plugin. Any object with this shape works, so another language or a server-side checker can stand in:

```ts
interface Dictionary {
	check(word: string): boolean | Promise<boolean>; // spelled right?
	suggest(word: string): readonly string[] | Promise<readonly string[]>; // best first
	add?(word: string): void | Promise<void>; // present only if something keeps the word
	watch?(changed: () => void): () => void; // call `changed` when the accepted words change
}
```

A word is asked once and its answer kept, until `watch` says the words changed. A `check` that throws or rejects counts the word as spelled right and reports the error.

### The keyboard

The card can open from the caret too. Bind the editor's `decorations.activateAtCaret` command to a chord, and that chord inside a misspelled word opens its suggestions. It has no chord until you give it one, through the editor's `keybindings` prop:

```ts
const keybindings = [{ chord: 'Alt+Enter', command: 'decorations.activateAtCaret' }];
```

In any of the menus, the arrow keys and Enter pick a row, and Escape closes it without writing anything.

### Your own menu

If you draw your own spelling UI, two functions do the reading and the writing, over the editor's handle and the dictionary you passed the plugin:

```ts
import { misspellingAt, replaceWord } from '@voithos-labs/aragonite-spellcheck';

const caret = editor.selectedRange(); // { from, to } in document bytes, or null
const word = caret && (await misspellingAt(editor, caret.from, dictionary));
// { from: 14, to: 17, word: 'teh' }, or null when the word there is spelled right

if (word) {
	const [fix] = await dictionary.suggest(word.word); // 'the'
	await replaceWord(editor, word, fix); // { ok: true }, as one undo step
}
```

`replaceWord` refuses with `{ ok: false, reason: 'moved' }` when the word's bytes no longer spell it (an edit landed in between), and writes nothing.

### Styling

Two tokens on the editor set the wave: `--md-spell-color` (its color, `#e5484d` by default) and `--md-spell-wave` (the curve, an SVG used as a mask). Each wave is a `.decoration-overlay.spell-overlay` element, for anything past that.

## License

Aragonite and its first party plugins are free software, released under [MPL-2.0](./LICENSE). The word list is SCOWL's, under its own permissive terms: see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
