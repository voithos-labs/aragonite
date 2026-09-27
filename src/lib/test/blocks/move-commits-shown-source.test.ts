// @vitest-environment jsdom
// A move from a block showing a widget's source writes the source first, on the key path and on
// the host's `runCommand` alike, so the moved block carries the edit and one undo takes back the
// move. Both the text block and the table cell hold a shown source in the DOM only.
//
// Miss-analysis: the only move-after-source test drove the dispatch with a hand-built target, so
// nothing failed when a component's chord target or the host's target dropped the write hook.
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
import { resetPluginPlatformForTests } from '$lib/testing';
import { latexPlugin } from '$lib/plugins/latex';
import type { MathRenderer } from '$lib/plugins/latex/math-renderer';

const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });

beforeEach(() => {
	resetPluginPlatformForTests();
	installLayoutStubs();
	// The reveal measures its caret through Range rects, which jsdom lacks.
	Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(async () => {
	await destroyMountedEditors();
	resetPluginPlatformForTests();
});

type Seam = { getBlockComponent(path: number[]): { enterEdgeWidget?(side: 'start'): boolean } };

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
