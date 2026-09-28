// @vitest-environment jsdom
// A move from a block showing a source the tree hasn't seen (a widget's in a text block or cell, a
// math block's own) writes it first, from the key and from `runCommand` alike, so the moved block
// keeps the edit and one undo reverts it.
// Miss-analysis: the one move-after-source test used a hand-built target, not the components'.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey, dispatchKey } from '$lib/test/harness/settle';
import { latexPlugin, MATH_BLOCK } from '$lib/plugins/latex';
import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
import type { AnyBlockKind } from '$lib/core/nodes';
import type { MathRenderer } from '$lib/plugins/latex/math-renderer';

const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });

beforeEach(() => {
	installLayoutStubs();
	// Showing a source measures the caret through Range rects, which jsdom lacks.
	Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(async () => {
	await destroyMountedEditors();
});

type Seam = {
	getBlockComponent(path: number[]): {
		enterEdgeWidget?(side: 'start'): boolean;
		focus?(offset: number): void;
	};
};

/** Show the `$x$` widget's source in the block at `path`, and edit it to `$y$` in the DOM. */
async function showAndEditSource(mounted: MountedEditor<Seam>, surface: HTMLElement) {
	const source = Array.from(surface.childNodes).find(
		(c): c is Text => c.nodeType === Node.TEXT_NODE && c.textContent?.includes('$x$') === true
	);
	expect(source, 'the widget source is not showing').toBeDefined();
	source!.textContent = source!.textContent!.replace('$x$', '$y$');
	await mounted.settle();
}

async function move(
	mounted: MountedEditor<Seam>,
	surface: HTMLElement,
	via: 'host' | 'key',
	key: KeyboardEventInit
) {
	if (via === 'host') mounted.instance.runCommand('block.moveDown');
	else await pressKey(surface, key);
	await mounted.settle();
	await mounted.settle();
}

describe('a move from a block showing a widget source', () => {
	for (const via of ['host', 'key'] as const) {
		it(`writes the source first in a text block (${via})`, async () => {
			const mounted = mountEditor<Seam>({
				source: '$x$\n\nnext\n',
				presentationMode: 'live',
				plugins: [latexPlugin({ renderer: stubRenderer })]
			});
			await mounted.settle();
			mounted.instance.__test.getBlockComponent([0]).enterEdgeWidget?.('start');
			await mounted.settle();
			const surface = surfaceAt(mounted, [0]);
			await showAndEditSource(mounted, surface);

			await move(mounted, surface, via, { key: 'ArrowDown', altKey: true });

			expect(mounted.source()).toBe('next\n\n$y$\n');
			mounted.instance.runCommand('history.undo');
			await mounted.settle();
			expect(mounted.source()).toBe('$y$\n\nnext\n');
		});

		it(`writes the source first in a table cell (${via})`, async () => {
			const mounted = mountEditor<Seam>({
				source: '| h |\n| --- |\n| a $x$ |\n\nnext\n',
				plugins: [latexPlugin({ renderer: stubRenderer })]
			});
			await mounted.settle();
			const surface = mounted.target.querySelectorAll<HTMLElement>('.table-cell')[1];
			placeCaret(surface, 5);
			dispatchKey(surface, { key: 'ArrowLeft' });
			await mounted.settle();
			await showAndEditSource(mounted, surface);

			await move(mounted, surface, via, { key: 'ArrowDown', ctrlKey: true, altKey: true });

			expect(mounted.source()).toBe('next\n\n| h |\n| --- |\n| a $y$ |\n');
		});
	}
});

// Miss-analysis: the block rows above covered the text block and the cell, and no row moved a
// plugin block built on the editable leaf, whose command target had no hook to write its source.
describe('a move from a math block showing its source', () => {
	const MOVE_KEY: KeybindingOverride = {
		chord: 'Alt+ArrowDown',
		command: 'block.moveDown',
		// The latex plugin declares the kind when the editor mounts, so the override names its string.
		kind: MATH_BLOCK as AnyBlockKind
	};

	/** Show the `$$` block's source and edit `old` to `new` in the DOM, where the edit lives until blur. */
	async function mountWithEditedMath(keybindings: KeybindingOverride[] = []) {
		const mounted = mountEditor<Seam>({
			source: '$$\nold\n$$\n\nnext\n',
			plugins: [latexPlugin({ renderer: stubRenderer })],
			keybindings
		});
		await mounted.settle();
		mounted.instance.__test.getBlockComponent([0]).focus?.(3);
		await mounted.settle();
		const source = mounted.target.querySelector<HTMLElement>('.math-block-source');
		expect(source, 'the math source is not showing').not.toBeNull();
		source!.textContent = '$$\nnew\n$$';
		return { mounted, source: source! };
	}

	for (const via of ['host', 'key'] as const) {
		it(`writes the source first (${via})`, async () => {
			const { mounted, source } = await mountWithEditedMath(via === 'key' ? [MOVE_KEY] : []);

			await move(mounted, source, via, { key: 'ArrowDown', altKey: true });

			expect(mounted.source()).toBe('next\n\n$$\nnew\n$$\n');
			mounted.instance.runCommand('history.undo');
			await mounted.settle();
			expect(mounted.source()).toBe('$$\nnew\n$$\n\nnext\n');
		});
	}

	it('keeps the edit when the kind binds no move key', async () => {
		const { mounted, source } = await mountWithEditedMath();

		await pressKey(source, { key: 'ArrowDown', altKey: true });
		expect(mounted.source()).toBe('$$\nold\n$$\n\nnext\n');
		source.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		await mounted.settle();
		expect(mounted.source()).toBe('$$\nnew\n$$\n\nnext\n');
	});
});
