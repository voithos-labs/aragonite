// @vitest-environment jsdom
// The drawn caret paints once per task, after Svelte's flush and the height measure, at the caret
// the render put back. jsdom has no layout, so a range's rect is stubbed from its offset and this
// proves the order of calls only; the e2e frame rows prove the order against a real paint.
// Miss-analysis: no row held a widget edge or counted the attributes a plain keystroke writes.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import type { DrawnCaret } from '#lib/caret/drawn-caret.svelte.js';
import type { CaretWriter } from '#lib/caret/widget-offset.js';

/** A collapsed caret in a connected text node sits 8px per character from x 100. */
const caretX = (offset: number) => 100 + offset * 8;

const realClientRects = Range.prototype.getClientRects;

beforeAll(() => {
	installLayoutStubs();
	Range.prototype.getClientRects = function (this: Range) {
		const node = this.startContainer;
		if (!this.collapsed || node.nodeType !== Node.TEXT_NODE || !node.isConnected) {
			return [] as unknown as DOMRectList;
		}
		return [new DOMRect(caretX(this.startOffset), 10, 0, 20)] as unknown as DOMRectList;
	};
	(window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
		matches: query === '(pointer: fine)',
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {}
	});
	enablePerfInstruments();
});

afterAll(() => {
	Range.prototype.getClientRects = realClientRects;
	delete (window as unknown as { matchMedia?: unknown }).matchMedia;
	disablePerfInstruments();
});

beforeEach(resetPerfInstruments);
afterEach(destroyMountedEditors);

interface CaretSeams {
	getDrawnCaret(): DrawnCaret;
	getCaretWriter(): CaretWriter;
}

async function mountAtCaret(at: number) {
	const editor: MountedEditor<CaretSeams> = mountEditor({ source: 'hello world\n' });
	const el = surfaceAt(editor, [0]);
	placeCaret(el, at);
	await editor.settle();
	resetPerfInstruments();
	return { editor, el };
}

function barX(editor: MountedEditor): number | null {
	const bar = editor.target.querySelector<HTMLElement>('.md-drawn-caret');
	if (bar?.getAttribute('data-caret-state') !== 'text') return null;
	const x = /translate\(([-\d.]+)px/.exec(bar.style.transform)?.[1];
	return x === undefined ? null : Number(x);
}

/** Types `letter` at `at` the way the browser inserts it, then sends the input event. */
function insertTyped(el: HTMLElement, at: number, letter: string): void {
	const text = el.firstChild as Text;
	text.insertData(at, letter);
	window.getSelection()!.collapse(text, at + 1);
	el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
}

describe('the drawn caret’s paint', () => {
	it('answers many requests in one task with one paint, after the flush', async () => {
		const { editor, el } = await mountAtCaret(5);
		const { getDrawnCaret, getCaretWriter } = editor.instance.__test;

		getDrawnCaret().request();
		getCaretWriter().placeCaretAtRaw(el, 2, { clamp: 'exact' });
		getDrawnCaret().request();
		insertTyped(el, 5, 'X');
		expect(perfSnapshot().caretPaintMs).toHaveLength(0);

		await editor.settle();
		expect(editor.source()).toBe('helloX world\n');
		expect(perfSnapshot().caretPaintMs).toHaveLength(1);
		expect(barX(editor)).toBe(caretX(6));
	});

	it('runs after the render, the caret write and the height measure', async () => {
		const { editor, el } = await mountAtCaret(5);
		const log: string[] = [];
		const restore = recordOrder(editor, el, log);
		try {
			insertTyped(el, 5, 'X');
			await editor.settle();
		} finally {
			restore();
		}
		const paint = log.indexOf('paint');
		expect(log.indexOf('render'), log.join(' ')).toBeGreaterThan(-1);
		expect(log.indexOf('render')).toBeLessThan(log.lastIndexOf('write'));
		expect(log.indexOf('measure', log.lastIndexOf('write'))).toBeGreaterThan(-1);
		expect(paint, log.join(' ')).toBeGreaterThan(log.lastIndexOf('write'));
		expect(log.lastIndexOf('measure'), log.join(' ')).toBeLessThan(paint);
	});
});

/** Logs the block's render, each caret write, each block height read and the bar's paint. */
function recordOrder(editor: MountedEditor, el: HTMLElement, log: string[]): () => void {
	const host = el.closest('.block-host')!;
	const own = <T extends object, K extends keyof T>(
		target: T,
		key: K,
		wrap: (fn: T[K]) => T[K]
	) => {
		const original = target[key];
		target[key] = wrap(original);
		return () => {
			target[key] = original;
		};
	};
	const undo = [
		own(
			Element.prototype,
			'replaceChildren',
			(fn) =>
				function (this: Element, ...nodes: (Node | string)[]) {
					if (this === el) log.push('render');
					return fn.apply(this, nodes);
				}
		),
		own(
			Selection.prototype,
			'setBaseAndExtent',
			(fn) =>
				function (this: Selection, ...args: Parameters<Selection['setBaseAndExtent']>) {
					log.push('write');
					return fn.apply(this, args);
				}
		),
		own(
			Element.prototype,
			'getBoundingClientRect',
			(fn) =>
				function (this: Element) {
					if (this === host) log.push('measure');
					return fn.call(this);
				}
		),
		own(
			Element.prototype,
			'setAttribute',
			(fn) =>
				function (this: Element, name: string, value: string) {
					if (name === 'data-caret-state' && editor.target.contains(this)) log.push('paint');
					return fn.call(this, name, value);
				}
		)
	];
	return () => undo.forEach((restore) => restore());
}

describe('the widget edge a click meant', () => {
	/** Paints `act` asks for, read once its task has settled. */
	async function paintsFrom(editor: MountedEditor, act: () => void): Promise<number> {
		await editor.settle();
		resetPerfInstruments();
		act();
		await editor.settle();
		return perfSnapshot().caretPaintMs.length;
	}

	it('is one per editor: a second owner replaces the first', async () => {
		const { editor } = await mountAtCaret(5);
		const caret = editor.instance.__test.getDrawnCaret();
		const [first, second] = [{}, {}];
		caret.armWidgetEdge(first, 3);
		caret.armWidgetEdge(second, 7);
		expect(caret.widgetEdgeFor(first)).toBeNull();
		expect(caret.widgetEdgeFor(second)).toBe(7);
	});

	it('changes only for its owner, and asks for a paint only when it changes', async () => {
		const { editor } = await mountAtCaret(5);
		const caret = editor.instance.__test.getDrawnCaret();
		const [owner, other] = [{}, {}];
		expect(await paintsFrom(editor, () => caret.armWidgetEdge(owner, 3))).toBe(1);
		expect(await paintsFrom(editor, () => caret.armWidgetEdge(other, null))).toBe(0);
		expect(caret.widgetEdgeFor(owner)).toBe(3);
		expect(await paintsFrom(editor, () => caret.armWidgetEdge(owner, 3))).toBe(0);
		expect(await paintsFrom(editor, () => caret.armWidgetEdge(owner, null))).toBe(1);
		expect(caret.widgetEdgeFor(owner)).toBeNull();
	});

	it('ends when its owner’s editable unregisters', async () => {
		const { editor } = await mountAtCaret(5);
		const caret = editor.instance.__test.getDrawnCaret();
		const owner = {};
		const unregister = caret.register({
			el: document.createElement('div'),
			drawable: () => true,
			widgetEdge: { owner, box: () => null, pressed: () => false }
		});
		caret.armWidgetEdge(owner, 3);
		unregister();
		expect(caret.widgetEdgeFor(owner)).toBeNull();
	});
});

describe('a plain keystroke', () => {
	it('writes no class and no caret mark on the editable', async () => {
		const { editor, el } = await mountAtCaret(5);
		expect(el.hasAttribute('data-caret-drawn')).toBe(true);
		const written: string[] = [];
		const watch = new MutationObserver((records) =>
			written.push(...records.map((r) => r.attributeName ?? '?'))
		);
		watch.observe(el, { attributes: true, attributeFilter: ['class', 'data-caret-drawn'] });
		insertTyped(el, 5, 'X');
		await editor.settle();
		insertTyped(el, 6, 'Y');
		await editor.settle();
		watch.disconnect();
		expect(editor.source()).toBe('helloXY world\n');
		expect(written).toEqual([]);
	});
});
