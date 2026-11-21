// @vitest-environment jsdom
// Miss-analysis: every piece row read a built-in, whose data is undefined, so no row asked what a
// plugin construct's piece carries, and `piece.data` was undefined for those too.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	builtin,
	definePlugin,
	inline,
	mark,
	markerPair,
	type Editor,
	type Piece
} from '#lib/plugin.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(() => destroyMountedEditors());

const id = (m: RegExpExecArray) => ({ id: m[1] });
const anchor = markerPair({
	name: 'anchor',
	label: 'Comment anchor',
	open: { prefix: '{>>', match: /\{>>([\w-]+)\}/, read: id },
	close: { prefix: '{<<', match: /\{<<([\w-]+)\}/, read: id },
	key: (data) => data.id,
	sample: 'a {>>c}text{<<c} z'
});
const note = inline({
	name: 'note',
	label: 'Note',
	prefix: '[[',
	match: /\[\[([^\]\n]+)\]\]/,
	read: (m) => ({ target: m[1] }),
	sample: '[[note]]',
	widget: { delete: 'whole', arrows: 'select', click: 'none' },
	draw(target, props) {
		target.textContent = props.data.target;
		return {};
	}
});
const tag = inline({
	name: 'tag',
	label: 'Tag',
	prefix: '#',
	match: (text, at, end) => {
		let to = at + 1;
		while (to < end && /\w/.test(text[to])) to++;
		return to > at + 1 ? to : -1;
	},
	read: (claim) => ({ tag: claim.slice(1) }),
	sample: '#tag',
	class: 'harness-tag'
});
const highlight = mark({
	name: 'highlight',
	label: 'Highlight',
	marker: '==',
	chord: 'Mod+Shift+h',
	sample: '==lit=='
});

async function piecesOf(source: string): Promise<readonly Piece[]> {
	let editor: Editor | undefined;
	const plugin = definePlugin({
		name: 'reads',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			inlines: [anchor, note, tag, highlight],
			setup: (e) => void (editor = e)
		})
	});
	const m = mountEditor({ source, plugins: [plugin], presentationMode: 'live' });
	await m.settle();
	return editor!.doc.blocks.flatMap((block) => block.pieces);
}

describe("a plugin construct's piece", () => {
	it('holds what each side of a marker pair read, so the author pairs them by it', async () => {
		const pieces = await piecesOf(
			'A {>>c1}noted{<<c1} word\n\nAcross {>>c2}two\n\nblocks{<<c2} end\n'
		);
		const ids = (side: typeof anchor.open) =>
			pieces.filter((p) => p.is(side)).map((p) => p.data.id);
		expect([ids(anchor.open), ids(anchor.close)]).toEqual([
			['c1', 'c2'],
			['c1', 'c2']
		]);
	});

	it('holds what an inline() widget or class construct read, by either matcher', async () => {
		const pieces = await piecesOf('see [[home]] and #todo\n');
		const widget = pieces.find((p) => p.is(note));
		const tagged = pieces.find((p) => p.is(tag));
		expect([widget?.is(note) && widget.data.target, tagged?.is(tag) && tagged.data.tag]).toEqual([
			'home',
			'todo'
		]);
	});

	it('holds nothing for a mark, which reads no data, nor for a built-in', async () => {
		const pieces = await piecesOf('a ==lit== `code`\n');
		const lit = pieces.find((p) => p.is(highlight));
		const code = pieces.find((p) => p.is(builtin.inlines.inlineCode));
		expect([lit?.kind, lit?.data, code?.data]).toEqual(['reads/highlight', undefined, undefined]);
	});
});
