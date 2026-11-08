// parrot-plugin.ts
import {
	definePlugin,
	lineBlock,
	type Block,
	type TextDrawContext
} from '@voithos-labs/aragonite/plugin';
import { PARROT_FRAMES } from './parrot-frames';
import './parrot.css';

// One strip the CSS scrolls a frame at a time. The closing newline matters: a `pre` drops a
// trailing blank line, and a strip a row short steps a fraction off every frame.
const REEL = PARROT_FRAMES.join('\n') + '\n';
// The clip window's height, which is why every frame has to be the same number of rows.
const FRAME_ROWS = PARROT_FRAMES[0].split('\n').length;

export const parrot = lineBlock({
	name: 'parrot',
	label: 'Party parrot',
	// The caption is whatever follows the marker, minus the spaces and tabs around it.
	match: /^%%parrot[ \t]*(?<text>.*?)[ \t]*$/,
	interrupts: true,
	sample: '%%parrot party responsibly',
	insert: { none: 'a toy, not a block anyone writes with' },
	draw(block, ctx) {
		const dom = document.createElement('div');
		dom.className = 'parrot-block';
		dom.style.setProperty('--parrot-rows', String(FRAME_ROWS));
		dom.style.setProperty('--parrot-frames', String(PARROT_FRAMES.length));

		const bird = document.createElement('div');
		bird.className = 'parrot';
		bird.setAttribute('aria-hidden', 'true');
		const reel = document.createElement('pre');
		reel.className = 'parrot-reel';
		reel.textContent = REEL;
		bird.append(reel);

		const caption = document.createElement('div');
		caption.className = 'parrot-caption';
		// The editor's element for the line: it shows while the caret is in the block.
		ctx.source.classList.add('parrot-source');
		dom.append(bird, caption, ctx.source);

		const show = (next: Block<never>, now: TextDrawContext) => {
			caption.textContent = next.body;
			caption.hidden = now.focused;
		};
		show(block, ctx);
		// A click on the caption lands on the letter clicked: its text is the block's text.
		return { dom, caret: caption, update: show };
	}
});

export function parrotPlugin() {
	return definePlugin({
		name: 'parrot',
		version: '0.1.0',
		editor: '^0.11.5',
		contributes: () => ({ blocks: [parrot] })
	});
}
