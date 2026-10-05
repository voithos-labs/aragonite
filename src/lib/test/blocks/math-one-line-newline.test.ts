// @vitest-environment jsdom
// A line break typed into a one-line `$$x^2$$` turns it into the multi-line form, as the source
// shows it and in the bytes the blur writes, in every mode where the source takes Enter.
// Miss-analysis: every Enter row opened a multi-line source, so none read a one-line `$$` with a
// line break in it, the shape the painter, the write rule and the parser each read differently.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { parse } from '$lib';
import { latexPlugin } from '$lib/plugins/latex';
import type { MathRenderer } from '$lib/plugins/latex/math-renderer';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeAtDomTextOffsets } from '$lib/cursor/widget-offset';
import { createSurfaceBackend } from '$lib/cursor/surface-backend';
import type { PresentationMode } from '$lib/presentation-mode';
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
// One definition for every row: installing a second is refused with a warning.
const math = latexPlugin({ renderer: stubRenderer });

beforeAll(() => {
	installLayoutStubs();
});
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

type Seam = {
	getBlockComponent(path: number[]): { focus?(offset: number): void };
	getDocument(): { children: { kind: string }[] };
};

const EDITING_MODES: PresentationMode[] = ['live', 'preview-block', 'preview-inline', 'source'];

function mathSource(editor: MountedEditor<Seam>): HTMLElement {
	const el = editor.target.querySelector<HTMLElement>('.math-block-source');
	expect(el, 'the math source is not showing').not.toBeNull();
	return el!;
}

async function showSourceAt(editor: MountedEditor<Seam>, offset: number): Promise<HTMLElement> {
	editor.instance.__test.getBlockComponent([0]).focus?.(offset);
	await editor.settle();
	const el = mathSource(editor);
	placeCaret(el, offset);
	return el;
}

const caretIn = (el: HTMLElement) => createSurfaceBackend({ getEl: () => el }).getRaw();

/** A `beforeinput` as the browser sends it, its target range collapsed at the caret. */
function inputAtCaret(el: HTMLElement, inputType: string): void {
	const at = caretIn(el) ?? 0;
	const target = createRangeAtDomTextOffsets(el, asDomTextOffset(at), asDomTextOffset(at));
	const e = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
	Object.defineProperty(e, 'getTargetRanges', { value: () => [target] });
	el.dispatchEvent(e);
}

// jsdom has no DataTransfer, so the event carries a clipboard holding plain text only.
function pasteText(el: HTMLElement, text: string): void {
	const e = new Event('paste', { bubbles: true, cancelable: true });
	const clipboardData = { files: [], types: ['text/plain'], getData: () => text };
	Object.defineProperty(e, 'clipboardData', { value: clipboardData });
	el.dispatchEvent(e);
}

async function blur(el: HTMLElement): Promise<void> {
	el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
	await settleEditor();
}

// Each route puts one line break at the caret.
const ROUTES: Array<[string, (el: HTMLElement) => Promise<void>]> = [
	['Enter', (el) => pressKey(el, { key: 'Enter' }).then(() => undefined)],
	['Shift+Enter', (el) => pressKey(el, { key: 'Enter', shiftKey: true }).then(() => undefined)],
	['a paragraph input', async (el) => inputAtCaret(el, 'insertParagraph')],
	[
		'a pasted line break',
		async (el) => {
			pasteText(el, '\n');
			await settleEditor();
		}
	]
];

describe('a line break at the end of a one-line math body', () => {
	const rows: Array<[string, string, string]> = [
		['with a paragraph below', '$$x^2$$\n\nafter\n', '$$\nx^2\n\n$$\n\nafter\n'],
		['as the last block', '$$x^2$$\n', '$$\nx^2\n\n$$\n'],
		[
			'above another multi-line equation',
			'$$x^2$$\n\nafter\n\n$$\ny\n$$\n',
			'$$\nx^2\n\n$$\n\nafter\n\n$$\ny\n$$\n'
		],
		// The multi-line form already does this; the one-line form has to land on the same bytes.
		['in the multi-line form', '$$\nx^2\n$$\n\nafter\n', '$$\nx^2\n\n$$\n\nafter\n']
	];

	for (const mode of EDITING_MODES) {
		for (const [shape, source, expected] of rows) {
			it(`${shape}, in ${mode} mode, gives the multi-line form`, async () => {
				const editor = mountEditor<Seam>({ source, presentationMode: mode, plugins: [math] });
				const bodyEnd = source.indexOf('x^2') + 3;
				const el = await showSourceAt(editor, bodyEnd);

				await pressKey(el, { key: 'Enter' });

				expect(el.textContent).toBe('$$\nx^2\n\n$$');
				expect(caretIn(el)).toBe(7);
				await blur(el);
				expect(editor.source()).toBe(expected);
				const live = editor.instance.__test.getDocument().children.map((c) => c.kind);
				expect(live).toEqual(parse(expected).children.map((c) => c.kind));
			});
		}
	}
});

describe('every route that puts a line break into a one-line math body', () => {
	for (const [route, breakLine] of ROUTES) {
		it(`${route} at the body's end leaves the caret on a new empty line`, async () => {
			const editor = mountEditor<Seam>({
				source: '$$x^2$$\n\nafter\n',
				presentationMode: 'live',
				plugins: [math]
			});
			const el = await showSourceAt(editor, 5);

			await breakLine(el);

			expect(el.textContent).toBe('$$\nx^2\n\n$$');
			expect(caretIn(el)).toBe(7);
			await blur(el);
			expect(editor.source()).toBe('$$\nx^2\n\n$$\n\nafter\n');
		});

		it(`${route} at the body's start pushes the body down a line`, async () => {
			const editor = mountEditor<Seam>({
				source: '$$x^2$$\n\nafter\n',
				presentationMode: 'live',
				plugins: [math]
			});
			const el = await showSourceAt(editor, 2);

			await breakLine(el);

			expect(el.textContent).toBe('$$\n\nx^2\n$$');
			expect(caretIn(el)).toBe(4);
			await blur(el);
			expect(editor.source()).toBe('$$\n\nx^2\n$$\n\nafter\n');
		});
	}

	it('splits a body mid-formula onto two lines', async () => {
		const editor = mountEditor<Seam>({
			source: '$$x^2$$\n\nafter\n',
			presentationMode: 'live',
			plugins: [math]
		});
		const el = await showSourceAt(editor, 3);

		await pressKey(el, { key: 'Enter' });

		expect(el.textContent).toBe('$$\nx\n^2\n$$');
		expect(caretIn(el)).toBe(5);
		await blur(el);
		expect(editor.source()).toBe('$$\nx\n^2\n$$\n\nafter\n');
	});

	// Miss-analysis: every CRLF row opened a multi-line source, which already carries its ending.
	it('takes a CRLF document’s ending on every line it adds', async () => {
		const editor = mountEditor<Seam>({
			source: '$$x^2$$\r\n\r\nafter\r\n',
			presentationMode: 'live',
			plugins: [math]
		});
		const el = await showSourceAt(editor, 5);

		await pressKey(el, { key: 'Enter' });

		expect(el.textContent).toBe('$$\r\nx^2\r\n\r\n$$');
		await blur(el);
		expect(editor.source()).toBe('$$\r\nx^2\r\n\r\n$$\r\n\r\nafter\r\n');
	});
});

// Backspace in an empty paragraph under a math block keeps the paragraph and puts the caret at
// the end of the formula's body, the not-mergeable rule; Enter there is the one-line row above.
describe('Backspace up into a one-line math block, then Enter', () => {
	it('leaves a well-formed multi-line block', async () => {
		const editor = mountEditor<Seam>({
			source: '$$x^2$$\n\nb\n',
			presentationMode: 'live',
			plugins: [math]
		});
		await editor.settle();
		const paragraph = surfaceAt(editor, [1]);
		// The browser deletes the character itself, so the input event is what the editor sees.
		paragraph.textContent = '';
		placeCaret(paragraph, 0);
		paragraph.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await editor.settle();
		expect(editor.source()).toBe('$$x^2$$\n\n\n');
		await pressKey(surfaceAt(editor, [1]), { key: 'Backspace' });
		await editor.settle();
		const el = mathSource(editor);
		expect(caretIn(el)).toBe(5);

		await pressKey(el, { key: 'Enter' });
		await blur(el);

		expect(editor.source()).toBe('$$\nx^2\n\n$$\n\n\n');
		const live = editor.instance.__test.getDocument().children.map((c) => c.kind);
		expect(live).toEqual(parse(editor.source()).children.map((c) => c.kind));
	});
});
