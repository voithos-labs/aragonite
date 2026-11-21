// @vitest-environment jsdom
// A block read from another editor or from a parsed document, handed to this editor's calls that
// take a block (`view.boxOf`, `view.overlay`, `view.reveal`, `select` by block and by cells): each
// answers as it does for one of its own blocks that has left the document, and a dev build warns once.
// Miss-analysis: every call's rows handed it the editor's own blocks, so the path taken from the
// block's own document was read against this one unseen.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { definePluginUnit, type Editor } from '#lib/schema/plugin-unit.js';
import { grammar } from '#lib/components/editor-root/headless-grammar.js';
import type { Block } from '#lib/schema/doc-view.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { takeDevWarnsOf } from '../../support/warn-gate';

beforeAll(() => installLayoutStubs());
afterEach(() => destroyMountedEditors());

// The same shape in both, so the block handed over has a block of this editor at its path.
const DOC = 'intro\n\npara one\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
const OTHER = 'other\n\nsecond\n\n| c | d |\n| - | - |\n| 3 | 4 |\n';

async function editorOn(source: string): Promise<{ editor: Editor; m: MountedEditor }> {
	let editor: Editor | undefined;
	const reader = definePluginUnit({
		name: 'unit-reader',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ setup: (e) => void (editor = e) })
	});
	const m = mountEditor({ source, plugins: [reader] });
	await m.settle();
	return { editor: editor!, m };
}

const selected = (editor: Editor) => {
	const s = editor.selection;
	return s && [s.anchor, s.head];
};

/** A call that takes a block, the block index it's handed, and what it did, as the test sees it. */
const CALLS: [string, number, (editor: Editor, block: Block) => Promise<unknown>][] = [
	['view.boxOf', 1, async (editor, block) => editor.view.boxOf(block) !== null],
	[
		'view.overlay',
		1,
		async (editor, block) => {
			const el = document.createElement('div');
			editor.view.overlay(el, block);
			return el.isConnected;
		}
	],
	// jsdom lays nothing out, so `reveal` and `select` resolve false either way: whether a block was
	// measured, and where the selection lands, tell.
	[
		'view.reveal',
		1,
		async (editor, block) => {
			const measured = vi.spyOn(Element.prototype, 'getBoundingClientRect');
			await editor.view.reveal(block);
			const reads = measured.mock.calls.length;
			measured.mockRestore();
			return reads > 0;
		}
	],
	[
		'select a block',
		1,
		async (editor, block) => {
			await editor.select(2);
			await editor.select({ block });
			return selected(editor);
		}
	],
	[
		'select cells',
		2,
		async (editor, block) => {
			await editor.select(2);
			await editor.select({ cells: block, anchor: [0, 0], head: [1, 1] });
			return selected(editor);
		}
	]
];

const SOURCES: [string, (at: number) => Promise<Block>][] = [
	['another editor', async (at) => (await editorOn(OTHER)).editor.doc.blocks[at]],
	['a parsed document', async (at) => grammar([]).parse(OTHER).blocks[at]]
];

describe('a block from another document', () => {
	describe.each(SOURCES)('from %s', (_source, foreignAt) => {
		it.each(CALLS)('%s answers as for a block that left the document', async (_call, at, call) => {
			const { editor, m } = await editorOn(DOC);
			const foreign = await foreignAt(at);
			const own = await call(editor, editor.doc.blocks[at]);
			const gone = editor.doc.blocks[at];
			m.instance.load(DOC);
			await m.settle();
			const left = await call(editor, gone);
			// The call can tell: its own block placed answers otherwise than one gone.
			expect(own).not.toEqual(left);
			expect(takeDevWarnsOf('foreign-block')).toEqual([]);
			expect(await call(editor, foreign)).toEqual(left);
			expect(takeDevWarnsOf('foreign-block')).toHaveLength(1);
		});
	});

	it('warns once for an editor, however many calls it is handed', async () => {
		const { editor } = await editorOn(DOC);
		const parsed = grammar([]).parse(OTHER);
		for (const [, at, call] of CALLS) await call(editor, parsed.blocks[at]);
		expect(takeDevWarnsOf('foreign-block').map((w) => w.message)).toEqual([
			"a block read from another editor or a parsed document isn't placed in this one; " +
				"read it from this editor's `doc`"
		]);
	});
});
