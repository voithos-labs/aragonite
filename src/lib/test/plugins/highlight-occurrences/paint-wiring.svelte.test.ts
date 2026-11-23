// @vitest-environment jsdom
// highlight-occurrences on a mounted editor: the caret's word paints, a key hides the marks until
// the typing pause, any other edit or a new document shows them at once, and a caret moving
// inside its word asks no block again. The pause's exact edges are the e2e rows', on a frozen
// clock (`e2e/tests/decorations/occurrence-paint.spec.ts`).
// Miss-analysis: the wiring rows drove a fake event bus, so none read what the editor painted.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { definePlugin, type Editor } from '#lib/plugin.js';
import {
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import { highlightOccurrences } from '#packages/highlight-occurrences/src/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

// The test handle's paint read, which no entry point publishes.
type Seam = {
	getDecorationEngine(): { paintOf(node: unknown, path: number[]): { marks: readonly unknown[] } };
	getDocument(): { children: readonly unknown[] };
};

beforeAll(() => installLayoutStubs());
afterEach(async () => {
	vi.useRealTimers();
	await destroyMountedEditors();
});

const SOURCE = 'the cat sat\n\na cat\n\ncatalog\n';

// `selections` counts the caret moves the plugins have heard, so a row can wait for one.
async function mounted(source = SOURCE) {
	let editor: Editor | undefined;
	let selections = 0;
	const reader = definePlugin({
		name: 'occurrence-reader',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			setup(mounted) {
				editor = mounted;
				mounted.on('selection', () => void selections++);
			}
		})
	});
	const m = mountEditor<Seam>({ source, plugins: [highlightOccurrences, reader] });
	await m.settle();
	return { m, editor: editor!, selections: () => selections };
}

/** How many marks each top-level block paints. */
function marks(m: MountedEditor<Seam>): number[] {
	const engine = m.instance.__test.getDecorationEngine();
	return m.instance.__test
		.getDocument()
		.children.map((node, i) => engine.paintOf(node, [i]).marks.length);
}

/** `expected` once the editor's caret read and its paint have landed. */
const marksBecome = (m: MountedEditor<Seam>, expected: number[]) =>
	vi.waitFor(() => expect(marks(m)).toEqual(expected));

async function caretAt(m: MountedEditor<Seam>, path: number[], offset: number) {
	placeCaret(surfaceAt(m, path), offset);
	await m.settle();
}

/** The caret on the first `cat`, then a key typed in that block, ending on another `cat`. */
async function typedOverCat() {
	const mounting = await mounted();
	await caretAt(mounting.m, [0], 5);
	await marksBecome(mounting.m, [1, 1, 0]);
	typeInto(surfaceAt(mounting.m, [0]), 'the cat sat a cat');
	await mounting.m.settle();
	return mounting;
}

describe('highlight-occurrences on a mounted editor', () => {
	it('marks each whole-word occurrence of the word at the caret', async () => {
		const { m } = await mounted();
		await caretAt(m, [0], 5);
		await marksBecome(m, [1, 1, 0]);
	});

	it('hides the marks at a key, and shows them once the typing pause passes', async () => {
		const { m } = await typedOverCat();
		expect(marks(m)).toEqual([0, 0, 0]);
		await marksBecome(m, [2, 1, 0]);
	});

	// The pause is frozen from the key on in the next two, so only the edit or the load can bring
	// the marks back.
	it('shows them at once after an edit that is no key', async () => {
		const { m, editor } = await typedOverCat();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		const end = editor.doc.text.length;
		await editor.edit().replace({ from: end, to: end }, '\ncat\n').commit();
		await m.settle();
		expect(marks(m)).toEqual([2, 1, 0, 1]);
	});

	it('shows them at once in a new document', async () => {
		const { m, editor } = await typedOverCat();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		m.props.source = 'cat and cat\n';
		await m.settle();
		await editor.select(1);
		await m.settle();
		expect(marks(m)).toEqual([2]);
	});

	it('asks no block again for a caret moving inside its word, and each for another word', async () => {
		const { m, selections } = await mounted();
		await caretAt(m, [0], 4);
		await marksBecome(m, [1, 1, 0]);
		enablePerfInstruments();
		resetPerfInstruments();
		const heard = selections();
		await caretAt(m, [0], 6);
		await vi.waitFor(() => expect(selections()).toBeGreaterThan(heard));
		await m.settle();
		expect(marks(m)).toEqual([1, 1, 0]);
		expect(perfSnapshot().paintCallPaths).toEqual([]);
		await caretAt(m, [0], 9);
		await marksBecome(m, [1, 0, 0]);
		expect([...perfSnapshot().paintCallPaths].sort()).toEqual(['0', '1', '2']);
	});

	it('leaves no typing pause running once the editor goes', async () => {
		const { m } = await mounted();
		await caretAt(m, [0], 5);
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		typeInto(surfaceAt(m, [0]), 'the cat sat a cat');
		await m.settle();
		await m.destroy();
		expect(vi.getTimerCount()).toBe(0);
	});
});
