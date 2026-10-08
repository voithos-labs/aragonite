// @vitest-environment jsdom
// The hover drag handle is on by default, and `false` turns it off.
// Miss-analysis: every e2e case passed `blockDragHandles` explicitly, so none asserted the default.
import { describe, it, expect, afterEach } from 'vitest';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
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
		mounted = mountEditor({
			source: '- one\n- two\n\nplain\n\n```js\ncode\n```\n',
			blockDragHandles: false
		});
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
		// Two items and nothing more: a list item's inner paragraph carries none.
		expect(handleCount()).toBe(2);
	});

	// Miss-analysis: the no-handle case ran a paragraph only, never a heading.
	it('renders no handle on a heading of either syntax, and one on the code beside them', () => {
		mounted = mountEditor({ source: '# Atx\n\nSetext\n===\n\n```\ncode\n```\n' });
		const handleOn = (path: string) =>
			mounted!.target.querySelector(
				`.block-host[data-block-path="${path}"] > .block-drag-handle`
			) !== null;
		expect(handleOn('[0]')).toBe(false);
		expect(handleOn('[1]')).toBe(false);
		expect(handleOn('[2]')).toBe(true);
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

const PICTURE = '![cat|200](/test-fixtures/sample.png)';

describe('the handle follows what a block is, not only the prop', () => {
	// Prose holding prose is background: neither the quote nor its paragraphs get a handle.
	it('renders no handle on a blockquote or the paragraphs inside it', () => {
		mounted = mountEditor({ source: '> a\n>\n> b\n' });
		expect(handleCount()).toBe(0);
	});

	it('renders no handle on a note card holding text', () => {
		mounted = mountEditor({ source: '> [!NOTE]\n> body text\n', plugins: [admonitionsPlugin()] });
		expect(handleCount()).toBe(0);
	});

	// A picture is not prose, and dragging is the only pointer way to move one.
	it('renders a handle on an image-only paragraph and none on an image beside words', () => {
		mounted = mountEditor({ source: `${PICTURE}\n\n${PICTURE} beside words\n` });
		const handleOn = (path: string) =>
			mounted!.target.querySelector(`.block-host[data-block-path="${path}"] > .block-drag-handle`);
		expect(handleOn('[0]')).not.toBeNull();
		expect(handleOn('[1]')).toBeNull();
	});

	it('keeps the picture handle with blockDragHandles=false, and gives no other', () => {
		mounted = mountEditor({ source: `${PICTURE}\n\nplain\n`, blockDragHandles: false });
		expect(handleCount()).toBe(1);
		expect(
			mounted.target.querySelector('.block-host[data-block-path="[0]"] > .block-drag-handle')
		).not.toBeNull();
	});

	it('renders no handle in reading mode, not even on an image-only paragraph', () => {
		mounted = mountEditor({ source: `${PICTURE}\n\n# head\n`, presentationMode: 'reading' });
		expect(handleCount()).toBe(0);
	});

	it('draws the handle as the six-dot grip glyph', () => {
		mounted = mountEditor({ source: '```js\ncode\n```\n' });
		expect(mounted.target.querySelectorAll('.block-drag-handle .grip svg path')).toHaveLength(6);
	});
});
