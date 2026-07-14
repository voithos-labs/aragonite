This project is an effort (perhaps in vain) to create a markdown editor that is both open source and not crap. In my book, this means that it has to be lossless, extendable, lean, fast, have a graceful ui/ux, and have hella good plugin interface. So you know, just some simplistic and easy to achieve goals [^1] [^2].

Note that aragonite is a work in progress [^3]. Its written in typescript and svelte [^4] [^5] [^6] [^7], and tested on chromium browsers (chrome and edge) [^8]. Yes, there are plans to port to different frontend frameworks and test in different browsers. No, not right now, sometime in the future.

For those of you who don't want to sit through a monologue, here's how to use the editor:

TODO: publish aragonite to npm and write a short snippet here for users to npm install svelte and aragonite

```svelte
<script>
	import { Editor } from 'aragonite';
	import 'aragonite/styles/editor-theme.css';

	let editor;
</script>

<Editor bind:this={editor} source={'# Hello\n'} theme="dark" />
```

To save the source, just do something like:

```svelte
<button onclick={() => save(editor.getSource())}>Save</button>
```

(obviously define the save function)

For more info go read [consumer-guide](./docs/guide/consumer-guide.md).

Now, for those who don't have better things to do.

# Origin

It begun one afternoon when I realized Obsidian wasn't open source.

Ok, actually, nothing so dramatic. The short of it is, two years ago, two dumbasses (Finn and I) decided to make a better Obsidian. We wanted to retain the benefits of Obsidian - store notes in a folder, use open note formats like .md so users aren't locked in, and have a good plugin platform; we also wanted to improve certain things, like making the codebase open source, have good cloud sync/note sharing/online collab, have a better editing experience, combine some of Notion's ui/ux etc etc. The editor library itself became aragonite, and the app became limestone, the companion codebase to aragonite. In our naiveness, we figured making an editor app should be easy. It's not, not by a long shot.

# Lossless

Why make aragonite lossless? What a stupid question, but let me answer it anyways. The philosophy is that you own your files (in limestone), so `serialize(parse(source)) !== source` would be pretty bad; one load and save from the app and your file is ruined. So the first principle of this editor is to maintain `serialize(parse(source)) === source` - the architecture itself also takes this into consideration, and is designed to maintain this principle easily.

We need a tree to act as the document model[^9] for an editor. Given our lossless principle, the natural conclusion is a concrete syntax tree. Naively, we can make it such that the editor parses the source into a tree whose nodes each hold their own slice of the original text, renders those slices as styled DOM, and saves by concatenating the slices back together. Serialization could be as simple as this:

```js
interface Serializable {
	prefix: string;
	children: { leadingTrivia: string; raw: string }[];
	suffix: string;
}

export function concatChildren(children: { leadingTrivia: string; raw: string }[]): string {
	let out = '';
	for (const c of children) out += c.leadingTrivia + c.raw;
	return out;
}

export function serialize(document: Serializable): string {
	return document.prefix + concatChildren(document.children) + document.suffix;
}
```

Well, funny things is, this implementation actually stuck around.

# Footnote

[^1]: read the [changelog](./docs/changelog.md) to experience my suffering.

[^2]: this is not even the first iteration of this editor; this is like my fourth try to write this piece of lovely shit.

[^3]: as steam users call it: in early access

[^4]: the superior frontend framework

[^5]: one day i might port this to react, one day

[^6]: angular users - sorry, i thought those don't exist anymore

[^7]: what does vue have that svelte and react doesnt have? a lower barrier to entry?

[^8]: it might work in safari/firefox, but I did not test them yet

[^9]: If you are suggesting a flat model right now, first of all, fuck off, second of all, why do people like hurting themselves?
