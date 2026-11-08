// @vitest-environment jsdom
// A mark's `interactive.onClick` is plugin code running on a user gesture, so a throw from it is
// reported through the decoration engine's mark error sink, which the editor turns into an
// `error` event, like every other decoration entry point.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import DecorationOverlay from '#lib/components/overlays/DecorationOverlay.svelte';
import type { BlockComponent } from '#lib/block-component.js';
import { parse } from '#lib/core/parser.js';
import { createDecorationEngine } from '#lib/decorations/decoration-state.svelte.js';
import type { MarkDecoration, MarkInteractions } from '#lib/decorations/types.js';
import { editorMountContext } from '../harness/mount-context';

/** jsdom measures every real range at zero width, which the overlay skips as too thin to
 *  paint, so this stand-in supplies the rect a browser would. */
function paintingLeaf(): BlockComponent {
	return {
		focus: () => {},
		getCursorOffset: () => null,
		editable: true,
		focusable: true,
		measurePartialRects: () => [new DOMRect(0, 0, 24, 16)]
	} as unknown as BlockComponent;
}

let instance: ReturnType<typeof mount> | null = null;
afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

async function mountOverlay(
	interactive: MarkInteractions
): Promise<{ path: number[]; error: unknown }[]> {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const blockEl = document.createElement('div');
	document.body.appendChild(blockEl);

	const mark: MarkDecoration = {
		type: 'mark',
		path: [0],
		start: 0,
		end: 3,
		class: 'probe-mark',
		interactive
	};
	const errors: { path: number[]; error: unknown }[] = [];
	const doc = parse('one\n');
	const engine = createDecorationEngine({
		getDoc: () => doc,
		onMarkError: (path, error) => errors.push({ path, error })
	});
	engine.addSource({ name: 'probe', provide: () => [mark] });

	instance = mount(DecorationOverlay, {
		target,
		props: { path: [0], blockRef: paintingLeaf(), blockEl },
		context: editorMountContext({ services: { decorations: engine } })
	});
	// The overlay measures on the frame after it mounts.
	await new Promise(requestAnimationFrame);
	flushSync();
	return errors;
}

function clickPaintedMark(): void {
	const painted = document.querySelector('.decoration-overlay') as HTMLElement;
	expect(painted, 'the overlay painted no rect to click').not.toBeNull();
	painted.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('an interactive mark contains and attributes its click handler', () => {
	it("reports a throwing onClick with the mark's path", async () => {
		const errors = await mountOverlay({
			onClick: () => {
				throw new Error('plugin onClick blew up');
			}
		});

		clickPaintedMark();

		expect(errors).toHaveLength(1);
		expect(errors[0].path).toEqual([0]);
		expect((errors[0].error as Error).message).toBe('plugin onClick blew up');
	});

	it('leaves a well-behaved onClick untouched', async () => {
		const onClick = vi.fn();
		const errors = await mountOverlay({ onClick });

		clickPaintedMark();

		expect(onClick).toHaveBeenCalledTimes(1);
		expect(errors).toHaveLength(0);
	});
});
