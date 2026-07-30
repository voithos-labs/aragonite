// @vitest-environment jsdom
//
// The generic directive container is the plugin tier's representative: everything it
// does below its own marker is `createContainerBlock`'s, and unlike the blockquote it
// renders CHROME BESIDE THE LIST. That sibling is what the seam's windowing lookups
// have to survive — they resolve the body through `:scope > .block-list`, documented as
// tolerating chrome siblings, and no other mounted container exercises that arm.
//
// The other half is the seam's DEFAULTS. Blockquote opts out of two of them at its own
// call site (reorderable children) and every bundled container supplies an ambient
// prefix or a focus element; this one supplies nothing, so what it renders is what an
// unconfigured plugin container gets. Each assertion below is therefore a decision
// somewhere in the seam, not a property of directives.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installDirectiveStubs, mountDirective, type MountedDirective } from './mount-directive';

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

		const first = containerApi.getBlockComponentByPath([0]);
		const second = containerApi.getBlockComponentByPath([1]);

		expect(first?.editable).toBe(true);
		expect(second).not.toBe(first);
		expect(containerApi.getBlockComponentByPath([2])).toBeNull();
	});

	it('lands focus in the first body child, never on the read-only marker', () => {
		mounted = mountDirective(BODY);

		mounted.containerApi.focus(0);

		expect(document.activeElement).toBe(
			mounted.box.querySelector('.block-host [contenteditable="true"]')
		);
		expect(mounted.containerApi.getCursorOffset()).toBe(0);
	});

	// The marker is chrome the container paints, not bytes the body owns. Forwarding the
	// opener line as `ambientPrefixForFirst` would look right — the cue still appears
	// above the body — while putting the fence into child 0's offset space, where every
	// caret and edit offset in that paragraph is measured.
	it('keeps the opener out of the body child it labels', () => {
		mounted = mountDirective(BODY);

		const marker = mounted.box.querySelector('.directive-marker')!;
		const firstBody = mounted.box.querySelector('.block-host [contenteditable]')!;

		expect(marker.textContent).toBe(':::foo');
		expect(firstBody.textContent).toBe('alpha');
		expect(mounted.box.textContent?.match(/:::foo/g)).toHaveLength(1);
	});

	// The seam defaults `reorderable` to false because an opaque container is a reorder
	// boundary; the blockquote overrides it to true at its own call site. A handle on a
	// body row here would be a dead affordance — `resolveReorderUnit` declines inside.
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
