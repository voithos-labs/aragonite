// @vitest-environment jsdom
// How often a character typed into a code block with hidden fence lines reads the fence regions:
// once for the edit check, once more for a bracket's wrap, which reads its own selection.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { asDomTextOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeAtDomTextOffsets } from '$lib/cursor/widget-offset';
import { mountCode, type MountedCode } from './mount-code';

const regionReads = vi.hoisted(() => ({ count: 0 }));

// Every fence-region read slices the block first, so a slice taken from inside `fenceRegions`
// counts one read.
vi.mock('$lib/components/blocks/code/code-renderer', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/components/blocks/code/code-renderer')>();
	return {
		...real,
		sliceFencedCode: (...args: Parameters<typeof real.sliceFencedCode>) => {
			if (new Error().stack?.includes('fenceRegions')) regionReads.count++;
			return real.sliceFencedCode(...args);
		}
	};
});

let mounted: MountedCode;

afterEach(async () => {
	await mounted.dispose();
	document.body.innerHTML = '';
});

describe('a typed character with the fence lines hidden', () => {
	it.each([
		{ name: 'a letter at a caret', data: 'a', range: [10, 10], reads: 1 },
		{ name: 'a bracket at a caret', data: '(', range: [10, 10], reads: 1 },
		{ name: 'a letter over a body range', data: 'a', range: [8, 12], reads: 1 },
		{ name: 'a bracket over a body range', data: '(', range: [8, 12], reads: 2 }
	])('$name reads the fence regions $reads time(s)', ({ data, range: [start, end], reads }) => {
		mounted = mountCode('```js\nconst x = 1\n```\n', {
			policies: { presentationMode: () => 'live' }
		});
		const range = createRangeAtDomTextOffsets(
			mounted.el,
			asDomTextOffset(start),
			asDomTextOffset(end)
		);
		mounted.el.focus();
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range!);
		regionReads.count = 0;

		mounted.el.dispatchEvent(
			new InputEvent('beforeinput', {
				inputType: 'insertText',
				data,
				bubbles: true,
				cancelable: true
			})
		);

		expect(regionReads.count).toBe(reads);
	});
});
