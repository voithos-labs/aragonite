// @vitest-environment jsdom
// A cut remembers the caret the core named for it: a paste of the entry that cut wrote, at the
// caret the cut left, goes back there and gives the cut back; any other paste there goes where the
// caret is, as it would anywhere.
// Miss-analysis: the remembered caret was handed to every paste at the cut's landing, so text with
// no entry landed inside the next line's indent, and only the paste of the cut back was ever run.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { insertBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import {
	clipboardGesture,
	mountCase,
	pasteGesture,
	pastePlainGesture,
	placeOwnedRange,
	placeRange,
	runHistory,
	type Editor,
	type Payload
} from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** A rule held whole in an item, above a line its removal leaves as prose: the core names the cut's
 *  caret inside that line's indent, and the editor holds the caret on its text. */
const SOURCE = 'intro\n\n- text\n  ***\n  ===\n\nlast\n';

async function cutRule(): Promise<{ editor: Editor; payload: Record<string, string> }> {
	const editor = mountCase(SOURCE, 'live');
	await editor.settle();
	const m = measured(editor.instance.__test.getDocument());
	const anchor = pointAtByte(m, SOURCE.indexOf('***'))!;
	const focus = pointAtByte(m, SOURCE.indexOf('==='))!;
	expect(await placeOwnedRange(editor, { anchor, focus })).toBe(true);
	const payload = await clipboardGesture(editor, 'cut', 'key');
	return { editor, payload };
}

it('the entry the cut wrote, pasted at its caret, gives the cut back', async () => {
	const { editor, payload } = await cutRule();
	await pasteGesture(editor, payload, 'key');
	expect(editor.source()).toBe(SOURCE);
});

it('text with no entry goes where the caret is, on the text the cut left', async () => {
	const { editor } = await cutRule();
	await pasteGesture(editor, { 'text/plain': 'x' }, 'key');
	expect(editor.source()).toBe('intro\n\n- text\n\n  x===\n\nlast\n');
});

it('the cut’s text pasted as plain text declines its entry, and its caret with it', async () => {
	const { editor, payload } = await cutRule();
	await pastePlainGesture(editor, payload['text/plain']);
	expect(editor.source()).toBe('intro\n\n- text\n\n  \\*\\*\\*===\n\nlast\n');
});

// Here the cut's caret is the one the editor holds, so the place is the entry's own and only the
// core's reading of a plain paste declines it.
it('the cut’s text pasted as plain text where its entry fits still declines it', async () => {
	const source = '**a**\n\n**b**\n';
	const editor = mountCase(source, 'live');
	await editor.settle();
	const m = measured(editor.instance.__test.getDocument());
	const range = { anchor: pointAtByte(m, 0)!, focus: pointAtByte(m, source.length - 1)! };
	expect(await placeOwnedRange(editor, range)).toBe(true);
	const payload = await clipboardGesture(editor, 'cut', 'key');
	await pastePlainGesture(editor, payload['text/plain']);
	expect(editor.source()).toBe('\\*\\*a\\*\\*\n\n\\*\\*b\\*\\*\n');
});

it('another entry of the editor’s own goes where the caret is', async () => {
	const { editor } = await cutRule();
	const landing = editor.instance.getSelection()!;
	const m = measured(editor.instance.__test.getDocument());
	const source = editor.source();
	const last = {
		anchor: pointAtByte(m, source.indexOf('last'))!,
		focus: pointAtByte(m, source.length - 1)!
	};
	expect(await placeOwnedRange(editor, last)).toBe(true);
	const copied = await clipboardGesture(editor, 'copy', 'key');
	await editor.instance.setSelection(landing);
	await editor.settle();
	await pasteGesture(editor, copied, 'key');
	expect(editor.source()).toBe('intro\n\n- text\n\n  last===\n\nlast\n');
});

// Miss-analysis: every row cut where the removal's caret was also its landing, so none cut where
// the landing moves on past it (into a heading's text, a title), which the entry never fit.
describe('a cut whose caret lands past where its removal left it pastes back', () => {
	const ROWS: [string, string][] = [
		['before a heading', 'first\n\n⟦***\n\n# hd⟧\n\n# h\n'],
		['before a titled callout', 'first\n\n⟦***\n\n# hd⟧\n\n:::tip Title\nin\n:::\n'],
		['before a leaf directive', 'first\n\n⟦***\n\n# hd⟧\n\n::spoiler[hi]\n'],
		['a rule held alone, before a heading', 'above\n\n⟦---⟧\n\n# h\n']
	];
	for (const mode of ['source', 'live'] as const)
		for (const [name, marked] of ROWS)
			it(`${mode}: ${name}`, async () => {
				const { editor, payload, source } = await cutMarked(marked, mode);
				await pasteGesture(editor, payload, 'key');
				expect(editor.source()).toBe(source);
			});
});

// Miss-analysis: every row pasted straight after its cut, so none asked what the cut's memory is
// worth once the document left the bytes the cut wrote and came back to them.
describe('a cut pastes back after a detour that ends on the bytes it left', () => {
	const focused = () => document.activeElement as HTMLElement;
	const DETOURS: [string, (editor: Editor) => Promise<void>][] = [
		[
			'an undo and a redo',
			async (editor) => {
				await runHistory(editor, 'undo');
				await editor.settle();
				await runHistory(editor, 'redo');
			}
		],
		[
			'a letter typed and deleted',
			async (editor) => {
				await insertBy('hardware key', focused(), 'q');
				await editor.settle();
				await pressHardwareKey(focused(), { key: 'Backspace' });
			}
		],
		[
			'the document swapped away and back',
			async (editor) => {
				const landing = editor.instance.getSelection()!;
				const left = editor.source();
				editor.props.source = 'other\n';
				await editor.settle();
				editor.props.source = left;
				await editor.settle();
				expect(await placeRange(editor, landing)).toBe(true);
			}
		]
	];
	const HOSTS: [string, string][] = [
		['before a heading', 'first\n\n⟦***\n\n# hd⟧\n\n# next\n'],
		['before a titled callout', 'first\n\n⟦***\n\n# hd⟧\n\n:::tip Title\nin\n:::\n']
	];
	for (const mode of ['source', 'live'] as const)
		for (const [host, marked] of HOSTS)
			for (const [detour, run] of DETOURS)
				it(`${mode}: ${detour}, ${host}`, async () => {
					const { editor, payload, source } = await cutMarked(marked, mode);
					const left = editor.source();
					await run(editor);
					await editor.settle();
					expect(editor.source()).toBe(left);
					await pasteGesture(editor, payload, 'key');
					expect(editor.source()).toBe(source);
				});

	it('a letter typed and left makes the paste one at the caret, as any paste', async () => {
		const { editor, payload } = await cutMarked(HOSTS[0][1], 'source');
		await insertBy('hardware key', focused(), 'q');
		await editor.settle();
		await pasteGesture(editor, payload, 'key');
		expect(editor.source()).toBe('first\n\n# q\n\n***\n\n# hdnext\n');
	});
});

/** The range `⟦⟧` of `marked`, cut by its chord: the editor, what the cut wrote, the source before. */
async function cutMarked(
	marked: string,
	mode: PresentationMode
): Promise<{ editor: Editor; payload: Payload; source: string }> {
	const source = marked.replace('⟦', '').replace('⟧', '');
	const editor = mountCase(source, mode);
	await editor.settle();
	const layout = documentLayout(measured(editor.instance.__test.getDocument()));
	const at = (byte: number) => {
		const point = layout.pointAt(byte);
		if (point) return { path: point.path, offset: point.offset };
		const block = [...layout.within(byte, byte)].find((b) => b.from === byte);
		return { path: block!.path, offset: 0 };
	};
	const range = { anchor: at(marked.indexOf('⟦')), focus: at(marked.indexOf('⟧') - 1) };
	// A rule alone takes no browser range, so the API selects it.
	if (!(await placeOwnedRange(editor, range))) await editor.instance.setSelection(range);
	await editor.settle();
	const payload = await clipboardGesture(editor, 'cut', 'key');
	expect(editor.source()).not.toBe(source);
	return { editor, payload, source };
}
