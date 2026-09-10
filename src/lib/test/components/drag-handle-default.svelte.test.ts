// @vitest-environment jsdom
//
// The hover drag handle is opt-in, so an embedder that says nothing gets a gutter-free surface.
// Miss-analysis: the e2e suite pinned `blockDragHandles=false` but drove every other case through
// a harness route that passes the prop explicitly, so nothing anywhere asserted the default — the
// one value every consumer actually gets.
import { describe, it, expect, afterEach } from 'vitest';
import { installLayoutStubs, mountEditor, type MountedEditor } from '../blocks/editor-mount';

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
	it('renders no handle when the prop is omitted', () => {
		mounted = mountEditor({ source: '- one\n\nplain\n' });
		expect(handleCount()).toBe(0);
	});

	it('renders handles once the embedder opts in', () => {
		mounted = mountEditor({ source: '- one\n\nplain\n', blockDragHandles: true });
		expect(handleCount()).toBeGreaterThan(0);
	});

	// A paragraph is the page's background: no grip, though it stays a reorder unit.
	it('renders no handle on a paragraph, and one on the list item beside it', () => {
		mounted = mountEditor({ source: '- one\n\nplain\n', blockDragHandles: true });
		// Path [1]: the top-level paragraph, not the one inside the list item (not a unit).
		const para = mounted.target.querySelector('.block-host[data-block-path="[1]"]')!;
		expect(para.classList.contains('reorder-host')).toBe(true);
		expect(para.querySelector(':scope > .block-drag-handle')).toBeNull();
		expect(mounted.target.querySelectorAll('.list-item-block > .block-drag-handle').length).toBe(1);
	});
});
