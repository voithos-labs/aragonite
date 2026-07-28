// @vitest-environment jsdom
//
// The generic `:::name` container's chrome marker is the opener line itself, so it
// is sliced from `raw`. Rebuilding it from the block's metadata — colon count plus
// name — silently drops everything else the line can hold: directive attributes
// and trailing spaces both round-trip through the CST but vanished from the cue
// rendered directly above the body they label.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import DirectiveContainerBlock from '$lib/components/blocks/directive/DirectiveContainerBlock.svelte';
import { activateDirectives } from '$lib/components/blocks/directive/activate-directives';
import { parse } from '$lib/core/parser';
import { editorMountContext } from '../harness/mount-context';

beforeAll(() => {
	activateDirectives();
	(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};
});

let dispose: (() => Promise<void>) | null = null;
afterEach(async () => {
	if (dispose) await dispose();
	dispose = null;
	document.body.innerHTML = '';
});

function mountDirective(source: string): HTMLElement {
	const doc = parse(source);
	expect(doc.children[0].kind).toBe('directiveContainer');
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(DirectiveContainerBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({ doc: { doc: () => doc } })
	});
	flushSync();
	dispose = async () => {
		await unmount(instance);
		target.remove();
	};
	return target;
}

describe('the directive container marker is the opener line verbatim', () => {
	it.each([
		[':::note\nbody\n:::\n', ':::note'],
		['::::note\nbody\n::::\n', '::::note'],
		[':::note {#id}\nbody\n:::\n', ':::note {#id}'],
		[':::note   \nbody\n:::\n', ':::note   ']
	])('%j renders %j', (source, expected) => {
		const target = mountDirective(source);

		expect(target.querySelector('.directive-marker')?.textContent).toBe(expected);
	});

	it('a CRLF opener drops only its line ending', () => {
		const target = mountDirective(':::note\r\nbody\r\n:::\r\n');

		expect(target.querySelector('.directive-marker')?.textContent).toBe(':::note');
	});
});
