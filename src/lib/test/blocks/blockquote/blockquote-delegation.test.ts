// @vitest-environment jsdom
//
// BlockquoteBlock is only wiring: every behaviour is handed on from `createContainerBlock` as
// one `containerApi`, and one that stops handing on is invisible until a user meets it. Mounted
// on its own deliberately, since `containerApi` is the component's own published interface and
// an Editor mount hands it to BlockHost rather than to the test. Nothing here commits, so a
// replaced node never goes stale.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import BlockquoteBlock from '$lib/components/blocks/BlockquoteBlock.svelte';
import { parse } from '$lib/core/parser';
import { editorMountContext } from '../../harness/mount-context';
import { installLayoutStubs } from '$lib/test/harness/mount-editor.svelte';
import { allowDevWarns } from '$lib/test/support/warn-gate';

// The harness mounts BlockHost without the component layer, so unregistered kinds render raw.
afterEach(() => allowDevWarns(['block-host']));

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

	// `createContainerBlock` defaults `reorderable` to false and the blockquote overrides it at
	// its own call, so dropping that prop silently loses the affordance: the children render but
	// cannot be dragged. A reorder unit, not a handle: prose carries no drag handle
	// (`components/drag-handle.ts`), so the class is all there is to check here, and the quote's
	// children can be reordered, unlike an opaque container's rows.
	it('marks its children as reorder units, unlike the default', () => {
		mounted = mountQuote('> alpha\n>\n> beta\n', true);

		const hosts = mounted.target.querySelectorAll('.blockquote-block > .block-list > .block-host');

		expect(hosts.length).toBe(2);
		for (const host of hosts) expect(host.classList.contains('reorder-host')).toBe(true);
	});
});
