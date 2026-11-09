// @vitest-environment jsdom
// A block overlay paints a changed mark or range with no animation frame in between: a drag moves
// the selection inside one, so a measure waiting for the next frame paints a frame behind it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import DecorationOverlay from '#lib/components/overlays/DecorationOverlay.svelte';
import SelectionOverlay from '#lib/components/overlays/SelectionOverlay.svelte';
import type { BlockComponent } from '#lib/block-component.js';
import { parse } from '#lib/core/parser.js';
import { createDecorationEngine } from '#lib/decorations/decoration-state.svelte.js';
import type { Decoration } from '#lib/decorations/types.js';
import { coverRange, rangeCoverage, type RangeCoverage } from '#lib/selection/range-coverage.js';
import { editorMountContext } from '../harness/mount-context';
import { settleEditor } from '../harness/settle';

const doc = parse('hello world, a longer line\n');

/** jsdom measures every range at zero size, so the leaf answers 8px a character. */
const leaf = {
	measurePartialRects: (start: number, end: number) => [
		new DOMRect(start * 8, 0, (end - start) * 8, 16)
	]
} as unknown as BlockComponent;

let instance: ReturnType<typeof mount> | null = null;
beforeEach(() => {
	vi.stubGlobal('requestAnimationFrame', () => 0);
});
afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

function blockElement(): { target: HTMLElement; blockEl: HTMLElement } {
	const target = document.createElement('div');
	const blockEl = document.createElement('div');
	document.body.append(target, blockEl);
	return { target, blockEl };
}

function paintedLeft(selector: string): string | undefined {
	return document.querySelector<HTMLElement>(selector)?.style.left;
}

/** Waits on `tick()` alone, so a measure held for a frame never lands. */
async function painted(selector: string, left: string): Promise<string | undefined> {
	await settleEditor(() => paintedLeft(selector) === left);
	return paintedLeft(selector);
}

describe('with animation frames held, a block overlay still paints a change', () => {
	it('repaints a re-provided mark', async () => {
		const engine = createDecorationEngine({ getDoc: () => doc });
		const { target, blockEl } = blockElement();
		instance = mount(DecorationOverlay, {
			target,
			props: { node: doc.children[0], path: [0], blockRef: leaf, blockEl, isContainer: false },
			context: editorMountContext({ services: { decorations: engine } })
		});
		let answer: Decoration[] = [{ type: 'mark', path: [0], start: 0, end: 5, class: 'm' }];
		const handle = engine.addSource({ name: 'probe', provide: () => answer });
		flushSync();
		expect(await painted('.decoration-overlay', '0px')).toBe('0px');

		answer = [{ type: 'mark', path: [0], start: 6, end: 11, class: 'm' }];
		handle.invalidate();

		expect(await painted('.decoration-overlay', '48px')).toBe('48px');
	});

	it('repaints a moved range', async () => {
		const over = (from: number, to: number) =>
			rangeCoverage(doc, coverRange(doc, { path: [0], offset: from }, { path: [0], offset: to }));
		let coverage: RangeCoverage | null = $state(over(0, 5));
		const { target, blockEl } = blockElement();
		instance = mount(SelectionOverlay, {
			target,
			props: { path: [0], blockRef: leaf, blockEl },
			context: editorMountContext({ services: { rangeCoverage: () => coverage } })
		});
		flushSync();
		expect(await painted('.selection-overlay-endpoint', '0px')).toBe('0px');

		coverage = over(6, 11);

		expect(await painted('.selection-overlay-endpoint', '48px')).toBe('48px');
	});
});
