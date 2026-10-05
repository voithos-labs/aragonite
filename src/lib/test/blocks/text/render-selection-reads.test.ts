// @vitest-environment jsdom
// A block's render re-applies the shown markers and the edge ring, and both ask the selection where
// the caret is, which forces a layout. A block the caret has never entered asks nothing, since a
// fling mounts many. Miss-analysis: removing the first-focus check left every suite green.
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '$lib/test/harness/mount-editor.svelte';

beforeAll(installLayoutStubs);

beforeEach(() => {
	vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await destroyMountedEditors();
});

const BLOCKS = 6;

/** Selection reads while a preview-inline document of `BLOCKS` paragraphs mounts. */
async function readsMounting(paragraph: string): Promise<number> {
	const reads = vi.spyOn(window, 'getSelection');
	const mounted = mountEditor({
		source: Array<string>(BLOCKS).fill(paragraph).join('\n\n') + '\n',
		presentationMode: 'preview-inline'
	});
	await mounted.settle();
	const count = reads.mock.calls.length;
	reads.mockRestore();
	await mounted.destroy();
	return count;
}

describe('a render in a block the caret never entered', () => {
	it('reads the selection no more for constructs than for plain words', async () => {
		const plain = await readsMounting('plain words and plain tail');
		const constructs = await readsMounting('plain *em* and **bold** tail');
		expect(constructs).toBe(plain);
	});
});
