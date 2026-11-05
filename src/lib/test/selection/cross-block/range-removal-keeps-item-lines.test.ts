// @vitest-environment jsdom
// A range removal that ends inside a later list item rewrites only the lines it joins: the lines
// under that item keep their bytes, as Backspace at the item's start leaves them. Today it keeps
// the end item as an item and rewrites the first line under it; the pins hold those bytes, so
// each expected failure fails for that reason and no other.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import {
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';

beforeAll(installLayoutStubs);

let mounted: MountedEditor;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

const SOURCE = '- i0\n  - i1\n    - i2\n  - i3\n    - i4\n\n    p5\n';
const I2 = [0, 0, 1, 0, 1, 0, 0];
const I3 = [0, 0, 1, 1, 0];

// Each removal with the bytes the list-move rule gives and the bytes it leaves today.
const REMOVALS: [name: string, from: number, to: number, ruled: string, today: string][] = [
	[
		'from the middle of i2 to the middle of i3',
		1,
		1,
		'- i0\n  - i1\n    - i3\n    - i4\n\n    p5\n',
		'- i0\n  - i1\n    - i3\n  - - i4\n\n    p5\n'
	],
	[
		'from the end of i2 to the start of i3',
		2,
		0,
		'- i0\n  - i1\n    - i2i3\n    - i4\n\n    p5\n',
		'- i0\n  - i1\n    - i2i3\n  - - i4\n\n    p5\n'
	]
];

async function removeOver(from: number, to: number): Promise<string> {
	mounted = mountEditor({ source: SOURCE });
	await mounted.instance.setSelection({
		anchor: { path: I2, offset: from },
		focus: { path: I3, offset: to }
	});
	await mounted.settle();
	await pressKey(surfaceAt(mounted, I3), { key: 'Backspace' });
	return mounted.source();
}

describe('a range removal ending inside a later list item', () => {
	for (const [name, from, to, ruled, today] of REMOVALS) {
		it.fails(`#816: Backspace ${name} keeps the lines under i3`, async () => {
			expect(await removeOver(from, to)).toBe(ruled);
		});

		it(`#816: Backspace ${name} still rewrites the line under i3`, async () => {
			expect(await removeOver(from, to)).toBe(today);
		});
	}
});
