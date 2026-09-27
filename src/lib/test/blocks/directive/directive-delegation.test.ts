// @vitest-environment jsdom
// The generic directive container stands in for every plugin container: it passes none of
// `createContainerBlock`'s optional dependencies, so each assertion tests the helper, not
// directives. It draws its marker beside the child list, the only mounted container that
// exercises the `:scope > .block-list` lookup.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installDirectiveStubs, mountDirective, type MountedDirective } from './mount-directive';
import { allowDevWarns } from '$lib/test/support/warn-gate';
import { componentAt } from '$lib/reactivity/child-list';

// The harness mounts BlockHost without the component layer, so unregistered kinds render raw.
afterEach(() => allowDevWarns(['block-host']));

beforeAll(installDirectiveStubs);

const BODY = ':::foo\nalpha\n\nbeta\n:::\n';

let mounted: MountedDirective | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

describe('the directive container delegates its body past its own chrome', () => {
	it('renders every body child through the inner list, beside the marker', () => {
		mounted = mountDirective(BODY);

		const hosts = mounted.box.querySelectorAll(':scope > .block-list > .block-host');

		expect(mounted.box.firstElementChild?.className).toContain('directive-marker');
		expect([...hosts].map((h) => h.getAttribute('data-block-path'))).toEqual(['[0,0]', '[0,1]']);
	});

	it('resolves the addressed body child, not merely the first one', () => {
		mounted = mountDirective(BODY);
		const { containerApi } = mounted;

		const first = componentAt(containerApi.childList(), [0]);
		const second = componentAt(containerApi.childList(), [1]);

		expect(first?.editable).toBe(true);
		expect(second).not.toBe(first);
		expect(componentAt(containerApi.childList(), [2])).toBeNull();
	});

	it('lands focus in the first body child, never on the read-only marker', () => {
		mounted = mountDirective(BODY);

		mounted.containerApi.focus(0);

		expect(document.activeElement).toBe(
			mounted.box.querySelector('.block-host [contenteditable="true"]')
		);
		expect(mounted.containerApi.getCursorOffset()).toBe(0);
	});

	// The marker is drawn by the container, not bytes the body owns. Passing the opener line as
	// `ambientPrefixForFirst` would put the fence into child 0's offset space.
	it('keeps the opener out of the body child it labels', () => {
		mounted = mountDirective(BODY);

		const marker = mounted.box.querySelector('.directive-marker')!;
		const firstBody = mounted.box.querySelector('.block-host [contenteditable]')!;

		expect(marker.textContent).toBe(':::foo');
		expect(firstBody.textContent).toBe('alpha');
		expect(mounted.box.textContent?.match(/:::foo/g)).toHaveLength(1);
	});

	// `createContainerBlock` defaults `reorderable` to false (an opaque container is a reorder
	// boundary), so a drag handle on a body row would do nothing: `resolveReorderUnit` refuses.
	it('leaves its body rows out of the reorder vocabulary, unlike the blockquote', () => {
		mounted = mountDirective(BODY, { policies: { blockDragHandles: () => true } });

		const hosts = mounted.box.querySelectorAll(':scope > .block-list > .block-host');

		expect(hosts.length).toBe(2);
		for (const host of hosts) {
			expect(host.classList.contains('reorder-host')).toBe(false);
			expect(host.querySelector(':scope > .block-drag-handle')).toBeNull();
		}
	});
});
