// @vitest-environment jsdom
// The window is read in the render pass that receives new children, before any effect runs, so
// it must already be built from them. Missed: every case flushed before reading the window.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { fixedOracle, makePara, mountListWindowing } from '../harness/list-windowing.svelte';
import type { CstNode } from '../../core/nodes';

// 100px per block against the harness's 1000px activation height: eleven blocks turn it on.
const BLOCK_PX = 100;

function blocks(count: number, tag: string): { children: CstNode[]; ids: string[] } {
	return {
		children: Array.from({ length: count }, (_, i) => makePara(`${tag}${i}\n`)),
		ids: Array.from({ length: count }, (_, i) => `${tag}${i}`)
	};
}

function mountWith(count: number) {
	const start = blocks(count, 'a');
	const children = $state(start.children);
	const ids = $state(start.ids);
	const mounted = mountListWindowing({
		children,
		ids,
		oracle: fixedOracle(BLOCK_PX),
		listHeight: count * BLOCK_PX
	});
	const receive = (next: { children: CstNode[]; ids: string[] }) => {
		children.splice(0, children.length, ...next.children);
		ids.splice(0, ids.length, ...next.ids);
	};
	return { ...mounted, receive };
}

describe('list windowing decides from the children it receives', () => {
	it('windows a child list past the height budget on the pass that receives it', () => {
		const { windowing, receive, cleanup } = mountWith(5);
		receive(blocks(2000, 'b'));
		const win = windowing.window;
		expect(win.active).toBe(true);
		expect(win.end - win.start).toBeLessThan(20);
		flushSync();
		cleanup();
	});

	it('slices every child of a list under the budget on the pass that receives it', () => {
		const { windowing, receive, cleanup } = mountWith(2000);
		expect(windowing.window.active).toBe(true);
		receive(blocks(3, 'b'));
		expect(windowing.window).toMatchObject({ active: false, start: 0, end: 3 });
		flushSync();
		cleanup();
	});

	it('slices every child after a count increase that stays under the budget', () => {
		const { windowing, receive, cleanup } = mountWith(5);
		receive(blocks(8, 'a'));
		expect(windowing.window).toMatchObject({ active: false, start: 0, end: 8 });
		flushSync();
		cleanup();
	});
});
