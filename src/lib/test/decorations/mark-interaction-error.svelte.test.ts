// @vitest-environment jsdom
//
// A decoration mark's `interactive.onClick` is plugin code on a user gesture.
// Every other decoration entry point — source `provide`, block badge mount,
// widget/island mount — routes a throw onto the `error` channel; the mark
// overlay's click handler did not, so a plugin bug surfaced as an unattributed
// window error. editor.md §12 calls that channel one seam for every contained
// failure.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import DecorationOverlay from '$lib/components/DecorationOverlay.svelte';
import type { BlockComponent } from '$lib/block-component';
import { createEditorEvents } from '$lib/editor-events';
import type { EditorError } from '$lib/editor-events';
import type { EditorServices } from '$lib/editor-keys';
import type { MarkDecoration } from '$lib/decorations/types';
import { editorMountContext } from '../harness/mount-context';

/** jsdom measures every real range at zero width, which the overlay skips as a
 *  degenerate sliver — so the leaf shim supplies the rect the browser would. */
function paintingLeaf(): BlockComponent {
	return {
		focus: () => {},
		getCursorOffset: () => null,
		editable: true,
		focusable: true,
		measurePartialRects: () => [new DOMRect(0, 0, 24, 16)]
	} as unknown as BlockComponent;
}

function markEngine(mark: MarkDecoration): EditorServices['decorations'] {
	return {
		sourceCount: 1,
		marksForPath: () => [{ dec: mark, index: 0 }],
		marksForDescendants: () => []
	} as unknown as EditorServices['decorations'];
}

let instance: ReturnType<typeof mount> | null = null;
afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

function mountOverlay(onClick: MarkDecoration['interactive']): EditorError[] {
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
		interactive: onClick
	};
	const events = createEditorEvents();
	const errors: EditorError[] = [];
	events.on('error', (e) => errors.push(e));

	const blockRef = paintingLeaf();
	instance = mount(DecorationOverlay, {
		target,
		props: { path: [0], blockRef, blockEl },
		context: editorMountContext({ services: { events, decorations: markEngine(mark) } })
	});
	flushSync();
	return errors;
}

function clickPaintedMark(): void {
	const painted = document.querySelector('.decoration-overlay') as HTMLElement;
	expect(painted, 'the overlay painted no rect to click').not.toBeNull();
	painted.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('an interactive mark contains and attributes its click handler', () => {
	it('routes a throwing onClick to the error seam as origin decoration', () => {
		const errors = mountOverlay({
			onClick: () => {
				throw new Error('plugin onClick blew up');
			}
		});

		clickPaintedMark();

		expect(errors).toHaveLength(1);
		expect(errors[0].origin).toBe('decoration');
		expect(errors[0].context?.path).toEqual([0]);
		expect((errors[0].error as Error).message).toBe('plugin onClick blew up');
	});

	it('leaves a well-behaved onClick untouched', () => {
		const onClick = vi.fn();
		const errors = mountOverlay({ onClick });

		clickPaintedMark();

		expect(onClick).toHaveBeenCalledTimes(1);
		expect(errors).toHaveLength(0);
	});
});
