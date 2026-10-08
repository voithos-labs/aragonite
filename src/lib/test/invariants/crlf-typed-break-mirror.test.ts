// @vitest-environment jsdom
// A line break typed or completed in an editable block takes the document's ending (G4.20): each
// gesture runs on an LF document and its CRLF mirror, through the mounted block's real handlers.
// Miss-analysis: GH #637, the mirror check ran pure functions only, so no row ever typed a break
// into a plugin leaf's source, the one surface that spliced a bare LF.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { asDomTextOffset } from '#lib/caret/coordinate-spaces.js';
import { createRangeAtDomTextOffsets } from '#lib/caret/widget-offset.js';
import { createSurfaceBackend } from '#lib/caret/surface-backend.js';
import { latexPlugin } from '#lib/plugins/latex/index.js';
import type { MathRenderer } from '#lib/plugins/latex/math-renderer.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '../harness/mount-editor.svelte';
import { pressKey, settleEditor } from '../harness/settle';

const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });
// One definition for both runs of a row: installing a second is refused with a warning.
const math = latexPlugin({ renderer: stubRenderer });

beforeAll(() => {
	installLayoutStubs();
});
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

type Seam = { getBlockComponent(path: number[]): { focus?(offset: number): void } };

const mirrorToCrlf = (bytes: string) => bytes.replace(/\n/g, '\r\n');

/** Shows the math block's source with the caret after `after`, which a document's ending moves. */
async function mathSourceAfter(editor: MountedEditor<Seam>, after: string): Promise<HTMLElement> {
	editor.instance.__test.getBlockComponent([0]).focus?.(0);
	await editor.settle();
	const el = editor.target.querySelector<HTMLElement>('.math-block-source');
	expect(el, 'the math source is not showing').not.toBeNull();
	placeCaret(el!, (el!.textContent ?? '').indexOf(after) + after.length);
	return el!;
}

/** A `beforeinput` as the browser sends it: its target range is the caret, or the `back`
 *  characters before it for a delete. */
function inputAtCaret(el: HTMLElement, inputType: string, back = 0): void {
	const at = createSurfaceBackend({ getEl: () => el }).getRaw() ?? 0;
	const target = createRangeAtDomTextOffsets(el, asDomTextOffset(at - back), asDomTextOffset(at));
	const e = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
	Object.defineProperty(e, 'getTargetRanges', { value: () => [target] });
	el.dispatchEvent(e);
}

async function blurMath(el: HTMLElement): Promise<void> {
	el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
	await settleEditor();
}

interface TypedBreak {
	name: string;
	/** LF-authored; the row runs it again mirrored to CRLF. */
	source: string;
	math?: true;
	type(editor: MountedEditor<Seam>): Promise<void>;
}

const BREAKS: TypedBreak[] = [
	{
		name: "Enter in a math block's source",
		source: '$$\nx\n$$\n',
		math: true,
		type: async (editor) => {
			const el = await mathSourceAfter(editor, 'x');
			await pressKey(el, { key: 'Enter' });
			await blurMath(el);
		}
	},
	{
		name: "a line break typed with no key in a math block's source",
		source: '$$\nx\n$$\n',
		math: true,
		type: async (editor) => {
			const el = await mathSourceAfter(editor, 'x');
			inputAtCaret(el, 'insertLineBreak');
			await blurMath(el);
		}
	},
	{
		name: 'the completion of a math source a delete emptied',
		source: '$$x$$\n',
		math: true,
		type: async (editor) => {
			const el = await mathSourceAfter(editor, 'x');
			inputAtCaret(el, 'deleteContentBackward', 1);
			await blurMath(el);
		}
	},
	{
		name: 'the completion of a bare math source as it shows',
		source: '$$$$\n',
		math: true,
		type: async (editor) => {
			await blurMath(await mathSourceAfter(editor, '$$'));
		}
	},
	{
		name: 'the completion of a bare code fence as the caret arrives',
		source: '```\n```\n',
		type: async (editor) => {
			placeCaret(surfaceAt(editor, [0]), 3);
			await settleEditor();
		}
	},
	{
		name: 'Enter in a code block',
		source: '```\nx\n```\n',
		type: async (editor) => {
			const el = surfaceAt(editor, [0]);
			placeCaret(el, (el.textContent ?? '').indexOf('x') + 1);
			await pressKey(el, { key: 'Enter' });
		}
	},
	{
		name: 'a soft break in a code block',
		source: '```\nx\n```\n',
		type: async (editor) => {
			const el = surfaceAt(editor, [0]);
			placeCaret(el, (el.textContent ?? '').indexOf('x') + 1);
			inputAtCaret(el, 'insertLineBreak');
			await settleEditor();
		}
	}
];

describe('G4.20 a typed line break mirrors the document’s ending', () => {
	async function typedBytes(row: TypedBreak, source: string): Promise<string> {
		const plugins = row.math ? [math] : [];
		const editor = mountEditor<Seam>({ source, plugins, presentationMode: 'live' });
		await row.type(editor);
		await editor.settle();
		return editor.source();
	}

	for (const row of BREAKS) {
		it(row.name, async () => {
			const lf = await typedBytes(row, row.source);
			await destroyMountedEditors();
			const crlf = await typedBytes(row, mirrorToCrlf(row.source));

			expect(lf).not.toBe(row.source);
			expect(crlf).toBe(mirrorToCrlf(lf));
		});
	}
});
