// @vitest-environment jsdom
// Footnotes in a mounted editor: two editors on one page keep their numbers and jumps apart, and a
// key in a long document asks only the block it changed for the labels it cites.
// Miss-analysis: the numbering and its cache were the package's own and keyed per document, so the
// editor's per-block answers had no row once the package handed its reads to `depends`.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { grammar } from '#lib/plugin.js';
import { collectFootnoteReferences, footnotes } from '#packages/footnotes/src/index.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	disablePerfInstruments();
});

type Mounted = MountedEditor;

async function mounted(source: string, listed: boolean): Promise<Mounted> {
	const m = mountEditor({
		source,
		plugins: listed ? [footnotes] : [],
		presentationMode: 'live'
	});
	await m.settle();
	return m;
}

const numbers = (m: Mounted) =>
	[...m.target.querySelectorAll('.footnote-ref')].map((ref) => ref.textContent);

function ctrlClick(el: Element | null | undefined): void {
	if (!el) throw new Error('nothing to click');
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
}

describe('two editors on one page, one listing footnotes', () => {
	const LISTED = 'See[^b] and[^a].\n\n[^a]: A note.\n\n[^b]: B note.\n';
	const UNLISTED = 'First[^a] then[^b].\n\n[^b]: Other.\n';

	it('numbers only the listing editor, and a reference typed in the other renumbers nothing', async () => {
		const listed = await mounted(LISTED, true);
		const unlisted = await mounted(UNLISTED, false);
		expect([numbers(listed), numbers(unlisted)]).toEqual([['1', '2'], []]);

		typeInto(surfaceAt(unlisted, [0]), '[^a] First[^a] then[^b].');
		await unlisted.settle();
		await listed.settle();
		expect([numbers(listed), numbers(unlisted)]).toEqual([['1', '2'], []]);
		expect(unlisted.source()).toBe('[^a] First[^a] then[^b].\n\n[^b]: Other.\n');
	});

	it('jumps from a reference and back from a marker inside its own editor', async () => {
		const listed = await mounted(LISTED, true);
		const unlisted = await mounted(UNLISTED, false);
		const before = unlisted.instance.getSelection();

		ctrlClick(listed.target.querySelector('.footnote-ref'));
		await listed.settle();
		expect(listed.instance.getSelection()?.focus).toEqual({ path: [2, 0], offset: 0 });

		ctrlClick(listed.target.querySelector('[data-block-path="[1]"] .footnote-def-marker'));
		await listed.settle();
		expect(listed.instance.getSelection()?.focus).toEqual({ path: [0], offset: 15 });
		expect(unlisted.instance.getSelection()).toEqual(before);
	});
});

// Miss-analysis: every jump row ran on a document of a few blocks, so a jump back that parsed
// every block of the document to find the first citation cost nothing there.
describe('a jump in a long document', () => {
	const fillers = (text: (i: number) => string) => Array.from({ length: 2000 }, (_, i) => text(i));
	const plain = fillers((i) => `Filler ${i} with no note.`);

	async function noteFirst(rest: string[]): Promise<Mounted> {
		const m = await mounted(
			['See[^a] here.', '[^a]: The note.', ...rest].join('\n\n') + '\n',
			true
		);
		enablePerfInstruments();
		resetPerfInstruments();
		return m;
	}

	it('parses none of the blocks after it, either way', async () => {
		const m = await noteFirst(plain);
		ctrlClick(m.target.querySelector('[data-block-path="[1]"] .footnote-def-marker'));
		await m.settle();
		expect(m.instance.getSelection()?.focus).toEqual({ path: [0], offset: 7 });
		ctrlClick(m.target.querySelector('.footnote-ref'));
		await m.settle();
		expect(m.instance.getSelection()?.focus).toEqual({ path: [1, 0], offset: 0 });
		expect(perfSnapshot().inlineComputeCount).toBeLessThan(10);
	});

	it('stops at the first citation, past which every block cites another note', async () => {
		const m = await noteFirst(fillers((i) => `Filler ${i} cites[^n${i}].`));
		ctrlClick(m.target.querySelector('[data-block-path="[1]"] .footnote-def-marker'));
		await m.settle();
		expect(m.instance.getSelection()?.focus).toEqual({ path: [0], offset: 7 });
		expect(perfSnapshot().blocksRead).toBeLessThan(10);
	});

	it('reads the references of only the blocks that hold one', () => {
		const doc = grammar([footnotes]).parse([...plain, 'See[^a] here.', '[^a]: Note.'].join('\n\n'));
		enablePerfInstruments();
		resetPerfInstruments();
		expect(collectFootnoteReferences(doc).map((ref) => ref.label)).toEqual(['a']);
		expect(perfSnapshot().inlineComputeCount).toBeLessThan(10);
	});
});

describe('a key in a long document', () => {
	const BLOCKS = 2000;

	it('asks only the block it changed for the labels it cites', async () => {
		const parts = Array.from(
			{ length: BLOCKS - 2 },
			(_, i) => `Paragraph ${i} cites[^n${i % 40}].`
		);
		const m = await mounted(
			['Lead cites[^a].', ...parts, '[^a]: The note.'].join('\n\n') + '\n',
			true
		);
		expect(numbers(m)[0]).toBe('1');

		enablePerfInstruments();
		resetPerfInstruments();
		typeInto(surfaceAt(m, [0]), 'Lead cites[^a] and[^z].');
		await m.settle();
		expect(perfSnapshot().keysAsked).toBe(1);
		expect(numbers(m).slice(0, 2)).toEqual(['1', '2']);
	});
});
