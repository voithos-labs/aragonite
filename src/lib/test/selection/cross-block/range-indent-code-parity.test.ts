// @vitest-environment jsdom
// Tab and Shift+Tab over code lines write the same bytes from a selection inside the code block
// as from a range that runs into it from the paragraph above.
// Miss-analysis: the code block's own indent and the range's were tested apart, each against its
// own expected bytes, so nothing held the two compositions to one answer.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt
} from '$lib/test/harness/mount-editor.svelte';
import { pressKey } from '$lib/test/harness/settle';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const TAB = { key: 'Tab' };
const SHIFT_TAB = { key: 'Tab', shiftKey: true };

const ROWS: [code: string, end: number, key: KeyboardEventInit, after: string][] = [
	['```\none\ntwo\nthree\n```\n', 10, TAB, '```\n\tone\n\ttwo\nthree\n```\n'],
	['```\n\tone\n    two\nthree\n```\n', 12, SHIFT_TAB, '```\none\ntwo\nthree\n```\n'],
	// Miss-analysis: no dedent row turned a line into a closer, so none saw the order check read the
	// fence the write rule lengthened as lost text.
	['```\none\n    ```\ntwo\n```\n', 15, SHIFT_TAB, '````\none\n```\ntwo\n````\n'],
	['```js\na\n  b\n```\n', 11, TAB, '```js\n\ta\n\t  b\n```\n']
];

/** The code block's source after `key` over its body up to `end`, from inside it or from above. */
async function pressOver(code: string, end: number, key: KeyboardEventInit, inside: boolean) {
	const mounted = mountEditor({ source: `para\n\n${code}` });
	await mounted.settle();
	if (inside) {
		selectRange(surfaceAt(mounted, [1]), code.indexOf('\n') + 1, end);
	} else {
		await mounted.instance.setSelection({
			anchor: { path: [0], offset: 1 },
			focus: { path: [1], offset: end }
		});
		await mounted.settle();
	}
	await pressKey(surfaceAt(mounted, [1]), key);
	const after = mounted.source().slice('para\n\n'.length);
	await mounted.destroy();
	return after;
}

describe('a code indent from inside the block and over a range', () => {
	for (const [code, end, key, after] of ROWS) {
		it(`${key.shiftKey ? 'Shift+Tab' : 'Tab'} over ${JSON.stringify(code)} to ${end}`, async () => {
			expect(await pressOver(code, end, key, true)).toBe(after);
			expect(await pressOver(code, end, key, false)).toBe(after);
		});
	}
});
