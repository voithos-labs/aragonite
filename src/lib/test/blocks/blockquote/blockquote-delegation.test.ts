// @vitest-environment jsdom
//
// BlockquoteBlock is pure wiring: every behavior is a delegation published from
// `createContainerBlock` as one `containerApi`, and a delegation that stops delegating is
// invisible until a user hits it. Bare mount deliberately — `containerApi` is the
// component's own surface, and an Editor mount hands it to BlockHost rather than to the
// test. Nothing here commits, so the node-replacement staleness never arises.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import BlockquoteBlock from '$lib/components/blocks/BlockquoteBlock.svelte';
import { parse } from '$lib/core/parser';
import { editorMountContext } from '../../harness/mount-context';
import { installLayoutStubs } from '../editor-mount';
import { expectDevWarns } from '$lib/test/support/warn-gate';

// The harness mounts BlockHost without the component layer, so unregistered kinds render raw.
afterEach(() => expectDevWarns(['block-host']));

beforeAll(installLayoutStubs);

function mountQuote(source: string, dragHandles = false) {
	const doc = parse(source);
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(BlockquoteBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({
			doc: { doc: () => doc },
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

	// The seam defaults `reorderable` to false; the blockquote overrides it at its own call
	// site, so dropping that prop is a silent affordance loss — children render, undraggable.
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
