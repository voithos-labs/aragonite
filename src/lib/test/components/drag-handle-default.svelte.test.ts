// @vitest-environment jsdom
//
// The hover drag handle is on by default, and `false` turns it off. Miss-analysis: the e2e suite
// pinned `blockDragHandles=false` but drove every other case through a test page that passes the
// prop explicitly, so nothing anywhere asserted the default, the one value every consumer gets.
import { describe, it, expect, afterEach } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';

installLayoutStubs();

let mounted: MountedEditor | undefined;

afterEach(async () => {
	await mounted?.destroy();
	mounted = undefined;
});

function handleCount(): number {
	return mounted!.target.querySelectorAll('.block-drag-handle').length;
}

describe('blockDragHandles default', () => {
	it('renders handles when the prop is omitted', () => {
		mounted = mountEditor({ source: '- one\n- two\n\nplain\n' });
		expect(handleCount()).toBeGreaterThan(0);
	});

	it('renders no handle once the embedder opts out', () => {
		mounted = mountEditor({ source: '- one\n- two\n\nplain\n', blockDragHandles: false });
		expect(handleCount()).toBe(0);
	});

	// Prose is the page's background: no handle, though it can still be reordered.
	it('renders no handle on a paragraph, and one per list item beside it', () => {
		mounted = mountEditor({ source: '- one\n- two\n\nplain\n' });
		// Path [1]: the top-level paragraph, not the one inside the list item.
		const para = mounted.target.querySelector('.block-host[data-block-path="[1]"]')!;
		expect(para.classList.contains('reorder-host')).toBe(true);
		expect(para.querySelector(':scope > .block-drag-handle')).toBeNull();
		expect(mounted.target.querySelectorAll('.list-item-block > .block-drag-handle').length).toBe(2);
	});

	// A list item's drag stays inside its list, so a lone item's handle could drop nowhere.
	it('renders no handle on the only item of a list', () => {
		mounted = mountEditor({ source: '- [ ] lone task\n\nplain\n' });
		const item = mounted.target.querySelector('.list-item-block')!;
		expect(item.classList.contains('reorder-host')).toBe(true);
		expect(item.classList.contains('handle-host')).toBe(false);
		expect(handleCount()).toBe(0);
	});

	it('shows the handle again once a second item exists', () => {
		mounted = mountEditor({ source: '- one\n- two\n' });
		expect(mounted.target.querySelectorAll('.list-item-block > .block-drag-handle').length).toBe(2);
	});
});
