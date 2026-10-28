// @vitest-environment jsdom
// The generic directive container stands in for every plugin container: it passes none of
// `createContainerBlock`'s optional dependencies, so each assertion tests the helper, not
// directives. Its opener line is its first child, drawn through the same inner list.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { installDirectiveStubs, mountDirective, type MountedDirective } from './mount-directive';
import { allowDevWarns } from '#lib/test/support/warn-gate.js';
import { componentAt } from '#lib/block-lists/child-list.js';

// The harness mounts BlockHost without the component layer, so unregistered kinds render raw.
afterEach(() => allowDevWarns(['block-host']));

beforeEach(installDirectiveStubs);

const BODY = ':::foo\nalpha\n\nbeta\n:::\n';

let mounted: MountedDirective | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

describe('the directive container delegates its rows to the inner list', () => {
	it('renders the opener line and every body child through the inner list', () => {
		mounted = mountDirective(BODY);

		const hosts = mounted.box.querySelectorAll(':scope > .block-list > .block-host');

		expect([...hosts].map((h) => h.getAttribute('data-block-path'))).toEqual([
			'[0,0]',
			'[0,1]',
			'[0,2]'
		]);
	});

	it('resolves the addressed body child, not merely the first one', () => {
		mounted = mountDirective(BODY);
		const { containerApi } = mounted;

		const first = componentAt(containerApi.childList(), [1]);
		const second = componentAt(containerApi.childList(), [2]);

		expect(first?.editable).toBe(true);
		expect(second).not.toBe(first);
		expect(componentAt(containerApi.childList(), [3])).toBeNull();
	});

	it('lands focus on the opener line, the first child', () => {
		mounted = mountDirective(BODY);

		mounted.containerApi.focus(0);

		expect(document.activeElement).toBe(
			mounted.box.querySelector('.block-host [contenteditable="true"]')
		);
		expect(mounted.containerApi.getCursorOffset()).toBe(0);
	});

	// The opener line is its own child, so no fence bytes enter the body child's offset space.
	it('keeps the opener out of the body child it labels', () => {
		mounted = mountDirective(BODY);

		const [row, firstBody] = mounted.box.querySelectorAll('.block-host [contenteditable]');

		expect(row.textContent).toBe(':::foo');
		expect(firstBody.textContent).toBe('alpha');
		expect(mounted.box.textContent?.match(/:::foo/g)).toHaveLength(1);
	});

	// `createContainerBlock` defaults `reorderable` to false (an opaque container is a reorder
	// boundary), so a drag handle on a body row would do nothing: `resolveReorderUnit` refuses.
	it('leaves its body rows out of the reorder vocabulary, unlike the blockquote', () => {
		mounted = mountDirective(BODY, { policies: { blockDragHandles: () => true } });

		const hosts = mounted.box.querySelectorAll(':scope > .block-list > .block-host');

		expect(hosts.length).toBe(3);
		for (const host of hosts) {
			expect(host.classList.contains('reorder-host')).toBe(false);
			expect(host.querySelector(':scope > .block-drag-handle')).toBeNull();
		}
	});
});
