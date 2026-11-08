# @voithos-labs/aragonite-spellcheck

Spell check for [aragonite](https://github.com/voithos-labs/aragonite): an English dictionary that answers whether a word is spelled right and what it should have been.

## What's in it

- `englishDictionary()`: the en_US word list from SCOWL. It loads the first time you ask about a word (about 200 KB gzipped, in a chunk of its own), and suggests up to five fixes for a word it doesn't know.
- `localStorageWords(key)`: somewhere to keep the words a user adds, if your app has nowhere better.

```ts
import { englishDictionary, localStorageWords } from '@voithos-labs/aragonite-spellcheck';

const dictionary = englishDictionary(localStorageWords('my-notes:spelling'));

await dictionary.check('speling'); // false
dictionary.suggest('speling'); // ['spelling', ...]
```

The editor never stores a word on its own. `englishDictionary({ words, onAddWord })` takes the words you saved and tells you about each one a user adds; leave `onAddWord` out and there's no way to add one, since nothing would keep it.

## Install

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-spellcheck
```

The package's version should match the editor's.

## License

Aragonite and its first party plugins are free software, released under [MPL-2.0](./LICENSE). The word list is SCOWL's, under its own permissive terms: see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
