// @vitest-environment jsdom
// A collapsed typed insert lands at the editor's caret, by key or soft keyboard, in a prose block
// and a table cell alike; a caret in a text node keeps the browser's own insert.
// Miss-analysis: each route that typed beside a widget was tested for its own engine's shape, so
// no row typed in source mode where the engine aimed the text away from the caret.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import {
	decideTypedInsert,
	type TypedInsertReads
} from '#lib/components/blocks/editable/typed-insert.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { cellAt, installTableLayoutStubs } from '../table/mount-table';
import { takeDevWarns } from '../../support/warn-gate';

let restoreTableLayout: () => void;
beforeAll(() => {
	installLayoutStubs();
	restoreTableLayout = installTableLayoutStubs();
	return () => restoreTableLayout();
});
afterEach(destroyMountedEditors);

interface Aim {
	node: Node;
	offset: number;
	collapsed?: boolean;
}

/** A soft keyboard's `insertText`, aimed where `aim` says, at the caret when it names nothing. */
function typeKeyless(el: HTMLElement, data: string, aim?: Aim): InputEvent {
	const event = new InputEvent('beforeinput', {
		inputType: 'insertText',
		data,
		bubbles: true,
		cancelable: true
	});
	const sel = window.getSelection()!;
	const at = aim ?? { node: sel.focusNode!, offset: sel.focusOffset };
	const target = new StaticRange({
		startContainer: at.node,
		startOffset: at.offset,
		endContainer: at.node,
		endOffset: at.collapsed === false ? (at.node.textContent?.length ?? 0) : at.offset
	});
	Object.defineProperty(event, 'getTargetRanges', { value: () => [target] });
	el.dispatchEvent(event);
	return event;
}

function mountAt(source: string, at: number, mode: PresentationMode = 'source') {
	const editor = mountEditor({ source, presentationMode: mode });
	const el = source.startsWith('|') ? cellAt(editor, 1, 0) : surfaceAt(editor, [0]);
	placeCaret(el, at);
	return { editor, el };
}

describe('a caret beside a widget, with no text node to type into', () => {
	it('takes a soft keyboard insert and writes it at the caret', async () => {
		const { editor, el } = mountAt('lead &copy;\n', 11);
		expect(window.getSelection()!.focusNode).toBe(el);
		const event = typeKeyless(el, 'Q');
		await editor.settle();
		expect(event.defaultPrevented).toBe(true);
		expect(editor.source()).toBe('lead &copy;Q\n');
	});

	it('takes a typed key at its keydown, the same way', async () => {
		const { editor, el } = mountAt('lead &copy;\n', 11);
		const event = await pressKey(el, { key: 'Q', bubbles: true, cancelable: true });
		expect(event.defaultPrevented).toBe(true);
		expect(editor.source()).toBe('lead &copy;Q\n');
	});

	it('leaves the key an IME opens a composition with to the IME', async () => {
		const { editor, el } = mountAt('lead &copy;\n', 11);
		const event = await pressKey(el, { key: 'q', keyCode: 229, bubbles: true, cancelable: true });
		expect(event.defaultPrevented).toBe(false);
		expect(editor.source()).toBe('lead &copy;\n');
	});

	it('leaves an empty line, where no widget sits, to the browser', async () => {
		const { editor, el } = mountAt('', 0);
		expect(window.getSelection()!.focusNode?.nodeType).not.toBe(Node.TEXT_NODE);
		const event = typeKeyless(el, 'Q');
		await editor.settle();
		expect(event.defaultPrevented).toBe(false);
	});
});

describe.each([
	['a prose block', 'Left<br>\n', 'LeftQ<br>\n'],
	['a table cell', '| H |\n| :- |\n| Left<br> |\n', '| H |\n| :- |\n| LeftQ<br> |\n']
])('a caret before a widget that ends %s', (_, source, typed) => {
	// Firefox fires the `beforeinput` there and then inserts nothing.
	it('writes the text at the caret', async () => {
		const { editor, el } = mountAt(source, 4);
		const event = typeKeyless(el, 'Q');
		await editor.settle();
		expect(event.defaultPrevented).toBe(true);
		expect(editor.source()).toBe(typed);
	});

	it('leaves text typed inside the line to the browser', async () => {
		const { editor, el } = mountAt(source, 2);
		const event = typeKeyless(el, 'Q');
		await editor.settle();
		expect(event.defaultPrevented).toBe(false);
	});
});

describe('a target the engine aims away from the caret', () => {
	it('in source mode, writes the text where the caret is', async () => {
		const { editor, el } = mountAt('hello\n', 5);
		const event = typeKeyless(el, 'Q', { node: el.firstChild!, offset: 2 });
		await editor.settle();
		expect(event.defaultPrevented).toBe(true);
		expect(editor.source()).toBe('helloQ\n');
	});

	// Chromium reads the point after a heading's hidden closing run as the end of `Hi`.
	it('in live mode, writes after the closing run the caret is past', async () => {
		const { editor, el } = mountAt('# Hi #\n', 6, 'live');
		const text = [...el.childNodes].find((n) => n.textContent === 'Hi')!;
		const event = typeKeyless(el, 't', { node: text, offset: 2 });
		await editor.settle();
		expect(event.defaultPrevented).toBe(true);
		expect(editor.source()).toBe('# Hi #t\n');
	});

	it('leaves a target at the caret to the browser', async () => {
		const { editor, el } = mountAt('hello\n', 3);
		const event = typeKeyless(el, 'Q');
		await editor.settle();
		expect(event.defaultPrevented).toBe(false);
		expect(editor.source()).toBe('hello\n');
	});

	// An autocorrect's insert names the word it replaces, which is the keyboard's own edit.
	it('leaves a target that spans text to the browser', async () => {
		const { editor, el } = mountAt('hello\n', 5);
		const event = typeKeyless(el, 'Q', { node: el.firstChild!, offset: 0, collapsed: false });
		await editor.settle();
		expect(event.defaultPrevented).toBe(false);
	});
});

describe('an insert the browser kept, read back (G1.161)', () => {
	/** A letter left to the browser at raw 4 of `lead`, then the text the browser left in its place. */
	async function readBack(landed: string): Promise<string[]> {
		const { editor, el } = mountAt('lead\n', 4);
		expect(typeKeyless(el, 'Z').defaultPrevented).toBe(false);
		el.firstChild!.textContent = landed;
		el.dispatchEvent(
			new InputEvent('input', { inputType: 'insertText', data: 'Z', bubbles: true })
		);
		await editor.settle();
		return takeDevWarns().map((w) => w.tag);
	}

	it('says nothing of a letter that landed at the caret', async () => {
		expect(await readBack('leadZ')).toEqual([]);
	});

	it('fires on a letter the browser put anywhere else', async () => {
		expect(await readBack('Zlead')).toEqual(['invariant:typed-insert-at-caret']);
	});
});

describe('decideTypedInsert: the order and the declines', () => {
	function reads(overrides: Partial<TypedInsertReads> = {}): {
		reads: TypedInsertReads;
		writes: string[];
	} {
		const el = document.createElement('div');
		el.textContent = 'abc';
		document.body.append(el);
		const writes: string[] = [];
		return {
			writes,
			reads: {
				composing: () => false,
				el: () => el,
				caretPosition: () => ({ node: el.firstChild!, offset: 1 }),
				caret: () => 1,
				rawStartOf: () => 1,
				onOpenLine: () => false,
				writes: {
					typeOverSelected: () => false,
					widgetBeside: () => true,
					widgetClosesAt: () => true,
					typeAt: (caret, text) => void writes.push(`${caret}:${text}`)
				},
				...overrides
			}
		};
	}

	const insert = (init: Partial<InputEventInit> = {}) =>
		new InputEvent('beforeinput', {
			inputType: 'insertText',
			data: 'Z',
			cancelable: true,
			...init
		});

	it('gives a widget selected whole the text before anything reads the caret', () => {
		const selected: string[] = [];
		const { reads: r } = reads({ caretPosition: () => null });
		r.writes!.typeOverSelected = (text) => {
			selected.push(text);
			return true;
		};
		const e = insert();
		expect(decideTypedInsert(e, r)).toEqual({ decided: true });
		expect(e.defaultPrevented).toBe(true);
		expect(selected).toEqual(['Z']);
	});

	it.each([
		['a composition', { composing: () => true }, 'composing'],
		['the open line', { onOpenLine: () => true }, 'open-line'],
		['a block that draws no widgets', { writes: undefined }, 'surface'],
		['a range', { caretPosition: () => null }, 'no-caret']
	] as const)('declines %s', (_, overrides, decline) => {
		const { reads: r, writes } = reads(overrides as Partial<TypedInsertReads>);
		expect(decideTypedInsert(insert(), r)).toEqual({ decided: false, decline });
		expect(writes).toEqual([]);
	});

	it('declines an input it cannot prevent, as Android sends one', () => {
		const { reads: r } = reads();
		expect(decideTypedInsert(insert({ cancelable: false }), r)).toEqual({
			decided: false,
			decline: 'not-cancelable'
		});
	});

	it('answers nothing for an input that is no typed insert', () => {
		const { reads: r } = reads();
		const replace = new InputEvent('beforeinput', { inputType: 'insertReplacementText' });
		expect(decideTypedInsert(replace, r)).toBeNull();
	});
});
