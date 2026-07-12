This project is an effort (perhaps in vain) to create a markdown editor that is both open source and not crap. In my book, this means that it has to be lossless, extendable, lean, fast, have a graceful ui/ux, and have hella good plugin interface. So you know, just some simplistic and easy to achieve goals. 

(Spoiler alert: its not simple. Read the [changelog](docs/changelog.md) to experience my suffering induced by trying to achieve those goals to varying degrees of success.)

(And this is not even the first iteration of this editor; this is like my, fourth? try to write this piece of lovely shit.)

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

For more info go read [consumer-guide](docs/editor/consumer-guide.md). ok bye.

Now, for those who don't have better things to do.

# Origin
It begun one afternoon when I realized Obsidian wasn't open source. 

Ok, actually, nothing so dramatic. Not a villain, not going to go through my entire backstory. The short of it is, two years ago, two dumbasses (Finn and I) decided to make a better Obsidian. We wanted to retain the benefits of Obsidian - store notes in a folder, use open note formats like .md so users aren't locked in, and have a good plugin platform; we also wanted to improve certain things, like making the codebase open source, have cheaper cloud sync/note share/online collab, have a better editing experience, etc etc. The editor library itself became aragonite, and the app became limestone, the companion codebase to aragonite.

In our naiveness, we figured making an editor app should be easy. It's not, not by a long shot. And its only two years later, on my fourth iteration of aragonite, that I gained a respect for Obsidian; for all its blemishes, it should be respected for it achieved.

# Lossless
