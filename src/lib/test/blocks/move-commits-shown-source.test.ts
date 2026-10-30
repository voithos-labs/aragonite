// @vitest-environment jsdom
// A move from a plugin leaf showing a source the tree hasn't seen (a math block's own) writes it
// first, from the key and from `runCommand` alike, so the moved block keeps the edit and one undo
// reverts it.
// Miss-analysis: the one move-after-source test used a hand-built target, not the components'.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { latexPlugin, MATH_BLOCK } from '#packages/latex/src/index.js';
import { parrotPlugin } from '#packages/parrot/src/index.js';
import { revealLeafPlugin } from './fixtures/reveal-leaf';
import type { KeybindingOverride } from '#lib/schema/keybinding-overrides.js';
import type { AnyBlockKind } from '#lib/core/nodes.js';
import type { MathRenderer } from '#packages/latex/src/math-renderer.js';

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

describe('a move from a plugin leaf showing its source', () => {
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

	// Miss-analysis: the host rows moved only the math block, whose component re-exported the hook
	// by hand, so a leaf component that didn't lost the edit with every suite green.
	const LEAVES = [
		{
			name: 'the parrot',
			plugin: () => parrotPlugin(),
			raw: '%%parrot old',
			edited: '%%parrot new',
			sourceSelector: '.parrot-source'
		},
		{
			name: 'a test leaf',
			plugin: () => revealLeafPlugin('move-leaf'),
			raw: '@@ old',
			edited: '@@ new',
			sourceSelector: '.reveal-leaf-source'
		}
	];

	for (const leaf of LEAVES) {
		it(`writes the source first from runCommand on ${leaf.name}`, async () => {
			const mounted = mountEditor<Seam>({
				source: `${leaf.raw}\n\nnext\n`,
				plugins: [leaf.plugin()]
			});
			await mounted.settle();
			mounted.instance.__test.getBlockComponent([0]).focus?.(3);
			await mounted.settle();
			const source = mounted.target.querySelector<HTMLElement>(leaf.sourceSelector);
			expect(source, 'the leaf source is not showing').not.toBeNull();
			source!.textContent = leaf.edited;

			await move(mounted, source!, 'host', {});

			expect(mounted.source()).toBe(`next\n\n${leaf.edited}\n`);
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
