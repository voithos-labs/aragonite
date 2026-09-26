// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerMathBlock } from '$lib/plugins/latex/latex-kind';
import { registerMermaidKind } from '$lib/plugins/mermaid/mermaid-kind';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';
import { installReorderDrag } from '$lib/editor-actions/reorder-drag';
import { parse } from '$lib/core/parser';
import { fixtureReading } from '../harness/fixture-grammar';

// Checks the root pointerdown listener's lifecycle: the unmount-mid-drag leak e2e cannot
// reach. The per-drag document listeners are covered by the Escape and no-op e2e.
describe('installReorderDrag: root listener lifecycle', () => {
	let editorRoot: HTMLElement;
	let added: number;
	let removed: number;

	beforeEach(() => {
		editorRoot = document.createElement('div');
		document.body.appendChild(editorRoot);
		added = 0;
		removed = 0;
		const origAdd = editorRoot.addEventListener.bind(editorRoot);
		const origRemove = editorRoot.removeEventListener.bind(editorRoot);
		editorRoot.addEventListener = ((type: string, ...rest: unknown[]) => {
			if (type === 'pointerdown') added++;
			return origAdd(type, ...(rest as [EventListenerOrEventListenerObject]));
		}) as typeof editorRoot.addEventListener;
		editorRoot.removeEventListener = ((type: string, ...rest: unknown[]) => {
			if (type === 'pointerdown') removed++;
			return origRemove(type, ...(rest as [EventListenerOrEventListenerObject]));
		}) as typeof editorRoot.removeEventListener;
	});

	afterEach(() => editorRoot.remove());

	function makeCtx(signal?: AbortSignal) {
		return {
			editorRoot,
			getScrollHost: () => editorRoot,
			moveReorderUnit: async () => {},
			overlay: { setGhost: () => {}, setLine: () => {} },
			getDoc: () => parse(''),
			reading: fixtureReading(),
			lifetimeSignal: signal
		};
	}

	it('attaches the root pointerdown listener and removes it on dispose', () => {
		const handle = installReorderDrag(makeCtx());
		expect(added).toBe(1);
		expect(removed).toBe(0);
		handle.dispose();
		expect(removed).toBe(1);
	});

	it('aborting the lifetime signal removes the listener without an explicit dispose', () => {
		const controller = new AbortController();
		installReorderDrag(makeCtx(controller.signal));
		expect(added).toBe(1);
		controller.abort();
		expect(removed).toBe(1);
	});

	it('a pre-aborted signal nets no live listener', () => {
		const controller = new AbortController();
		controller.abort();
		installReorderDrag(makeCtx(controller.signal));
		expect(added - removed).toBe(0);
	});

	it('double dispose is idempotent (removes once, no throw)', () => {
		const handle = installReorderDrag(makeCtx());
		handle.dispose();
		expect(() => handle.dispose()).not.toThrow();
		expect(removed).toBe(1);
	});
});

// The ghost's label keeps the words the drag was designed with: an object Finn named reads that
// name, and anything else reads its first words.
// Miss-analysis: only the table's label had a test, so renaming the rest never went red.
describe('the drag ghost names what it carries', () => {
	beforeAll(() => {
		resetPluginPlatformForTests();
		registerMathBlock();
		registerMermaidKind();
		registerDetailsKind();
	});
	afterAll(() => resetPluginPlatformForTests());

	function ghostFor(source: string, text: string, rows = 0): string | undefined {
		const doc = parse(source);
		const root = document.createElement('div');
		const list = document.createElement('div');
		const host = document.createElement('div');
		host.className = 'block-host reorder-host';
		host.dataset.blockPath = '[0]';
		host.dataset.blockKind = doc.children[0].kind;
		host.append(text);
		for (let r = 0; r < rows; r++) {
			const row = document.createElement('div');
			row.className = 'table-row';
			row.append(document.createElement('div'), document.createElement('div'));
			host.append(row);
		}
		const handle = document.createElement('span');
		handle.className = 'block-drag-handle';
		host.append(handle);
		list.append(host);
		root.append(list);
		document.body.append(root);
		let label: string | undefined;
		const drag = installReorderDrag({
			editorRoot: root,
			getScrollHost: () => null,
			moveReorderUnit: async () => {},
			overlay: { setGhost: (g) => void (label = g?.label ?? label), setLine: () => {} },
			getDoc: () => doc,
			reading: fixtureReading()
		});
		handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		drag.dispose();
		root.remove();
		return label;
	}

	it.each([
		['```ts\nx = 1\n```\n', 'x = 1', 'Code'],
		['$$\nx^2\n$$\n', 'x2', 'Equation'],
		['```mermaid\ngraph TD\n```\n', 'graph TD', 'Diagram'],
		['---\n', '', 'Divider'],
		['<details>\n<summary>Sum</summary>\n\nbody\n\n</details>\n', 'Sum body', 'Details']
	])('an object Finn named keeps his label: %j', (source, text, label) => {
		expect(ghostFor(source, text)).toBe(label);
	});

	it('a table reads its shape', () => {
		expect(ghostFor('| a | b |\n| - | - |\n| 1 | 2 |\n', 'a b 1 2', 2)).toBe('Table · 2 × 2');
	});

	it.each([
		['<div>\nhtml here\n</div>\n', '<div> html here </div>'],
		['[ref]: /url\n', '[ref]: /url'],
		['plain words\n', 'plain words']
	])('anything else reads its first words: %j', (source, text) => {
		expect(ghostFor(source, text)).toBe(text);
	});

	it('a paragraph of pictures reads Image', () => {
		expect(ghostFor('![a](x)\n', '')).toBe('Image');
	});
});
