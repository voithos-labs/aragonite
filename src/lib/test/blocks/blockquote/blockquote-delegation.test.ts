// @vitest-environment jsdom
//
// BlockquoteBlock is pure wiring: it owns no keymap, no chrome and no state, and
// publishes its entire BlockComponent surface from `createContainerBlock` as one
// `containerApi` export. Every one of its behaviors is therefore a delegation, and a
// delegation that stops delegating is invisible until a user hits it. `containerApi` —
// the surface BlockHost normalizes to and every focus walk reads through — has no test
// anywhere in the repo.
//
// These mount the real component over a real CST and assert the delegation ARRIVES:
// children rendered by the inner BlockList, refs published back into the container's
// state, and the forwarded members resolving through those refs.
//
// Deliberately a BARE mount, unlike the gesture suites beside it, which mount the
// Editor: `containerApi` is the component's own published surface and an Editor mount
// hands it to BlockHost, not to the test. The tradeoff is that a bare mount passes a
// raw node prop into `$state`-backed ref sinks, so the ref path compares a raw object
// against a proxy read-back; the compiled `===` normalizes both sides, which is why
// this works, and it is also why `state_proxy_equality_mismatch` shows up on list
// edits. Nothing here commits, so the node-replacement staleness that forced the
// Editor mount elsewhere never arises.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import BlockquoteBlock from '$lib/components/blocks/BlockquoteBlock.svelte';
import { parse } from '$lib/core/parser';
import { containerMountContext } from '../container-mount';
import { installLayoutStubs } from '../editor-mount';

beforeAll(installLayoutStubs);

function mountQuote(source: string, dragHandles = false) {
	const doc = parse(source);
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(BlockquoteBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: containerMountContext(() => doc, {
			policies: { blockDragHandles: () => dragHandles }
		})
	});
	flushSync();
	return { instance, target, doc };
}

let mounted: ReturnType<typeof mountQuote>;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	document.body.innerHTML = '';
});

describe('blockquote delegates to its inner BlockList', () => {
	it('renders every child through the inner list, inside its own box', () => {
		mounted = mountQuote('> alpha\n>\n> beta\n');
		const box = mounted.target.querySelector('.blockquote-block')!;

		const hosts = box.querySelectorAll(':scope > .block-list > .block-host');

		expect([...hosts].map((h) => h.getAttribute('data-block-path'))).toEqual(['[0,0]', '[0,1]']);
	});

	it('resolves the addressed child, not merely the first one', () => {
		mounted = mountQuote('> alpha\n>\n> beta\n');

		const first = mounted.instance.containerApi.getBlockComponentByPath([0]);
		const second = mounted.instance.containerApi.getBlockComponentByPath([1]);

		expect(first?.editable).toBe(true);
		expect(second).not.toBe(first);
		expect(mounted.instance.containerApi.getBlockComponentByPath([2])).toBeNull();
	});

	it('lands focus in the first child when the container is focused', () => {
		mounted = mountQuote('> alpha\n>\n> beta\n');

		mounted.instance.containerApi.focus(0);

		expect(document.activeElement).toBe(
			mounted.target.querySelector('.block-host [contenteditable]')
		);
		expect(mounted.instance.containerApi.getCursorOffset()).toBe(0);
	});

	// The container seam defaults `reorderable` to false (opaque plugin containers are
	// a reorder boundary); the blockquote overrides it to true at its own call site, so
	// its inner blocks ARE reorder units. Dropping that one prop is a silent affordance
	// loss — the children still render, they just stop being draggable.
	it('marks its children as reorder units, unlike the seam default', () => {
		mounted = mountQuote('> alpha\n>\n> beta\n', true);

		const hosts = mounted.target.querySelectorAll('.blockquote-block > .block-list > .block-host');

		expect(hosts.length).toBe(2);
		for (const host of hosts) {
			expect(host.classList.contains('reorder-host')).toBe(true);
			expect(host.querySelector(':scope > .block-drag-handle')).not.toBeNull();
		}
	});
});
