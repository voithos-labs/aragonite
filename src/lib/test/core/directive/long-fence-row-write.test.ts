// @vitest-environment jsdom
// A key in the run of colons of a long `::::` fence holding a nested container writes the colons
// typed, and the row reads as its bytes say; a body edit that needs a longer fence still grows it.
// Miss-analysis: every opener-line row edited a three-colon fence, whose body asks no growth, so
// the rebuild re-adding colons over a typed row never showed.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { dispatchPaste, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { makeSearchReplace, scanCompiled } from '#lib/test/harness/search-replace.js';
import { serialize } from '#lib/core/serializer.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

type Editor = MountedEditor<EditorTestSurface>;
type Step = { at: [number[], number] } | { key: string } | { paste: string };

/** Runs `steps` on `source`, returning the source after each key or paste; every step leaves the
 *  tree as a reload reads it and fires no dev check. */
async function run(source: string, mode: PresentationMode, steps: Step[]): Promise<string[]> {
	const editor: Editor = mountEditor({
		source,
		presentationMode: mode,
		plugins: [admonitionsPlugin()]
	});
	await editor.settle();
	const seen: string[] = [];
	for (const step of steps) {
		if ('at' in step) {
			placeCaret(surfaceAt(editor, step.at[0]), step.at[1]);
			await editor.settle();
			continue;
		}
		const focused = document.activeElement as HTMLElement;
		if ('paste' in step) dispatchPaste(focused, step.paste);
		else if ((await pressHardwareKey(focused, { key: step.key })) === 'browser') {
			// jsdom has no engine for a delete the editor leaves to the browser, so it is done here.
			const range = window.getSelection()!.getRangeAt(0);
			if (step.key === 'Backspace') range.setStart(range.startContainer, range.startOffset - 1);
			else range.setEnd(range.endContainer, range.endOffset + 1);
			range.deleteContents();
			const inputType = step.key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward';
			focused.dispatchEvent(new InputEvent('input', { inputType, bubbles: true }));
		}
		await editor.settle();
		expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
		expect(describeConvergence(editor.instance.__test.getDocument())).toBeNull();
		seen.push(editor.source());
	}
	return seen;
}

const MODES: PresentationMode[] = ['live', 'source'];
const row = (offset: number): Step => ({ at: [[0, 0], offset] });
const body: Step = { at: [[0, 1], 1] };
const key = (k: string): Step => ({ key: k });
const NESTED = '\n:::warn\nw\n:::\n';

const F4 = '::::note Hi\nx\n:::tip\nner\n:::\n::::\n';
const REST4 = '\nx\n:::tip\nner\n:::\n::::\n';
const F5 = ':::::note Hi\nx\n:::tip\nner\n:::\n:::::\n';
const REST5 = '\nx\n:::tip\nner\n:::\n:::::\n';

describe('a key in the run of colons writes the colons typed', () => {
	// [name, source, offset in the row, key, after the key, after a `w`]
	const ROWS: [string, string, number, string, string, string][] = [
		['four colons, a letter', F4, 2, 'x', '::x::note Hi' + REST4, '::xw::note Hi' + REST4],
		[
			'four colons, a colon',
			F4,
			2,
			':',
			':::::note Hi\nx\n:::tip\nner\n:::\n:::::\n',
			':::w::note Hi\nx\n:::tip\nner\n:::\n:::::\n'
		],
		['four colons, Backspace', F4, 3, 'Backspace', ':::note Hi' + REST4, '::w:note Hi' + REST4],
		['four colons, Delete', F4, 1, 'Delete', ':::note Hi' + REST4, ':w::note Hi' + REST4],
		['five colons, a letter', F5, 3, 'x', ':::x::note Hi' + REST5, ':::xw::note Hi' + REST5],
		[
			'five colons, a colon',
			F5,
			2,
			':',
			'::::::note Hi\nx\n:::tip\nner\n:::\n::::::\n',
			':::w:::note Hi\nx\n:::tip\nner\n:::\n::::::\n'
		],
		['five colons, Backspace', F5, 4, 'Backspace', '::::note Hi' + REST5, ':::w:note Hi' + REST5],
		['five colons, Delete', F5, 2, 'Delete', '::::note Hi' + REST5, '::w::note Hi' + REST5],
		[
			'a generic directive container',
			'::::box Hi\nx\n:::tip\nner\n:::\n::::\n',
			2,
			'x',
			'::x::box Hi\nx\n:::tip\nner\n:::\n::::\n',
			'::xw::box Hi\nx\n:::tip\nner\n:::\n::::\n'
		]
	];
	for (const [name, source, offset, k, after, then] of ROWS)
		for (const mode of MODES)
			it(`${name}, ${mode}`, async () => {
				expect(await run(source, mode, [row(offset), key(k), key('w')])).toEqual([after, then]);
			});

	it('a replace over the row writes its colons as replaced', async () => {
		const { deps, sr } = makeSearchReplace('::::box Hi\nx\n:::tip\nner\n:::\n::::\n');
		await sr.replaceAll(scanCompiled(deps.doc, '::::box', { caseSensitive: true }), ':::box');
		expect(serialize(deps.doc)).toBe(':::box Hi\nx\n:::tip\nner\n:::\n::::\n');
		expect(describeConvergence(deps.doc)).toBeNull();
	});
});

describe('a body edit still grows the fence it needs', () => {
	const F3 = ':::note Hi\nx\n:::\n';
	// [name, source, steps, the source after the last step]
	const ROWS: [string, string, Step[], string][] = [
		[
			'a nested container pasted into a three-colon body',
			F3,
			[body, { paste: NESTED }],
			'::::note Hi\nx\n\n\n:::warn\nw\n:::\n::::\n'
		],
		[
			'a closing run typed on a body line',
			F3,
			[body, key('Enter'), key(':'), key(':'), key(':')],
			'::::note Hi\nx\n\n:::\n::::\n'
		],
		[
			'a nested container pasted after a colon was deleted',
			F4,
			[row(4), key('Backspace'), body, { paste: NESTED }],
			'::::note Hi\nx\n\n\n:::warn\nw\n:::\n:::tip\nner\n::::\n::::\n'
		],
		[
			'a body letter after a colon was typed',
			F4,
			[row(2), key(':'), body, key('q')],
			':::::note Hi\nxq\n:::tip\nner\n:::\n:::::\n'
		],
		[
			'a title letter after a colon was deleted',
			F4,
			[row(4), key('Backspace'), row(10), key('q')],
			':::note Hiq' + REST4
		]
	];
	for (const [name, source, steps, last] of ROWS)
		for (const mode of MODES)
			it(`${name}, ${mode}`, async () => {
				expect((await run(source, mode, steps)).at(-1)).toBe(last);
			});
});
