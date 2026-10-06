// @vitest-environment jsdom
// The empty paragraph Enter leaves a list with is itself a blank line, so it and the block after it
// share one, and the tree the exit leaves is the tree its bytes reload to.
// Miss-analysis: the exit rows asserted bytes only, and none compared the tree with a reload of
// them, so a doubled blank line under an ordered list's middle exit read as a plain byte change.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import type { Document } from '$lib/core/nodes';
import { describeConvergence } from '$lib/testing/parse-convergence';
import { installLayoutStubs, mountEditor, pressKeyAt } from '$lib/test/harness/mount-editor.svelte';

beforeAll(installLayoutStubs);

type Seam = { getDocument(): Document };
let mounted: ReturnType<typeof mountEditor<Seam>>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

const ENTER = { key: 'Enter' };

// Each shape presses Enter in the empty middle item at `emptyPath`.
const SHAPES: [shape: string, source: string, emptyPath: number[], exited: string][] = [
	['an ordered list', '1. a\n2. \n3. b\n', [0, 1, 0], '1. a\n\n\n2. b\n'],
	['an ordered list in a quote', '> 1. a\n> 2. \n> 3. b\n', [0, 0, 1, 0], '> 1. a\n>\n>\n> 2. b\n'],
	['a bullet list', '- a\n- \n- b\n', [0, 1, 0], '- a\n\n\n- b\n'],
	['an item holding a paragraph', '- a\n- \n\n  p\n- b\n', [0, 1, 0], '- a\n\n\np\n- b\n'],
	[
		'an item holding a paragraph, in a quote',
		'> - a\n> - \n>\n>   p\n> - b\n',
		[0, 0, 1, 0],
		'> - a\n>\n>\n> p\n> - b\n'
	]
];

describe('Enter out of an empty middle item leaves one blank line', () => {
	for (const [shape, source, emptyPath, exited] of SHAPES) {
		it(`in ${shape}`, async () => {
			mounted = mountEditor<Seam>({ source });
			await pressKeyAt(mounted, emptyPath, 0, ENTER);

			expect(mounted.source()).toBe(exited);
			expect(describeConvergence(mounted.instance.__test.getDocument())).toBeNull();
		});
	}
});
