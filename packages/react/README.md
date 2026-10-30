# @voithos-labs/aragonite-react

Aragonite as a react component; works with react 18 and 19, next included. What is aragonite? Read the short (your mileage may vary) [readme](https://github.com/voithos-labs/aragonite/blob/main/README.md), or try it out at [aragonite.dev](https://aragonite.dev).

## Install

Install the core package and this component:

```bash
npm install @voithos-labs/aragonite @voithos-labs/aragonite-react
```

## Use it

```tsx
import { useRef, useState } from 'react';
import { Aragonite, type EditorHandle } from '@voithos-labs/aragonite-react';
import '@voithos-labs/aragonite/style.css';
import '@voithos-labs/aragonite/styles/editor-theme.css';

function Note() {
	const [text, setText] = useState('> That is not dead which can eternal lie,\n> And with strange aeons even death may die.\n');
	const editor = useRef<EditorHandle>(null);

	return (
		<Aragonite ref={editor} value={text} onChange={setText} theme="light" style={{ height: '70vh' }} />
	);
}
```

Relevant (or irrelevant, fuck if i know) details:

- Rather not hold state? Pass `defaultValue` instead of `value`/`onChange` and the editor keeps the document itself.
- Every other prop is an editor option (`theme`, `plugins`, `header` for a node above the first block, ...), and the ref gets you the handle (`getSource()`, `runCommand()`, ...) once it mounts.
- Next: import the two stylesheets in your root layout. The component is already `'use client'`, so a server component can render it.
- Writing a plugin? Its blocks can be react components too: `reactBlockView` turns one into a block view, and `reactView` does the same for an inline widget, a decoration or a menu row ([react and vue blocks](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/plugin-guide/react-and-vue.md)).

## More

The [consumer guide](https://github.com/voithos-labs/aragonite/blob/main/docs/guide/consumer-guide.md#react) has the rest: props, handle's methods, events, theming, etc. etc.

## License

Aragonite is free software, released under [MPL-2.0](./LICENSE): use it, study it, fork it, embed it in whatever you're building, closed source included. The one string attached: if you change aragonite's own files, you share those changes under the same license.
