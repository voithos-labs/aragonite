// @vitest-environment jsdom
// A clipboard ending in a line ending pasted over a literal block held whole on a file's last line,
// which has no line break, lands as on a last line that has one: the block gives way, so its text
// is no literal text that could take the ending as a line of its own (`syntax-tree.md` § The last
// line), as any other block held whole does. Source mode holds those blocks whole.
// Miss-analysis: the open-end rows held a paragraph or a heading whole, never a literal block, which
// the last-line rule set aside as text the ending lands in, so no dev check saw the line it gained.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { mountCase, pasteGesture, placeRange } from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** `clip` pasted over `⟦ ⟧` in source mode, then a typed letter: both bytes, no dev check. */
async function pasted(marked: string, clip: string) {
	const editor = mountCase(marked.replace(/[⟦⟧]/g, ''), 'source');
	await editor.settle();
	const doc = measured(editor.instance.__test.getDocument());
	const [from, to] = [marked.indexOf('⟦'), marked.indexOf('⟧') - 1];
	const [anchor, focus] = [pointAtByte(doc, from)!, pointAtByte(doc, to)!];
	expect(await placeRange(editor, { anchor, focus })).toBe(true);
	await pasteGesture(editor, { 'text/plain': clip }, 'key');
	await editor.settle();
	const after = editor.source();
	expect(
		describeConvergence(editor.instance.__test.getDocument(), editor.instance.__test.getGrammar())
	).toBeNull();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
	await editor.settle();
	expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
	const typed = editor.source();
	await destroyMountedEditors();
	return { after, typed };
}

const LITERAL: [string, string][] = [
	['a fence', '```\ncode\n```'],
	['an indented code block', '    code'],
	['an HTML block', '<div>\nx\n</div>']
];
const CLIPS = ['\n', '\n\n', 'x\n', 'x\n\ny\n'];

for (const [name, block] of LITERAL)
	for (const clip of CLIPS) {
		const on = `the open last line held whole, ${JSON.stringify(clip)}`;
		it(`${name} on ${on}: lands as the paragraph in its place`, async () => {
			expect(await pasted(`alpha\n\n⟦${block}⟧`, clip)).toEqual(
				await pasted('alpha\n\n⟦beta⟧', clip)
			);
		});
		it(`${name} on ${on}: lands as a heading held whole there`, async () => {
			expect(await pasted(`alpha\n\n⟦${block}⟧`, clip)).toEqual(
				await pasted('alpha\n\n⟦# head⟧', clip)
			);
		});
	}

for (const clip of CLIPS)
	it(`a fence in a quote on the open last line held whole, ${JSON.stringify(clip)}: as a heading there`, async () => {
		expect(await pasted('> alpha\n>\n> ⟦```\n> code\n> ```⟧', clip)).toEqual(
			await pasted('> alpha\n>\n> ⟦# head⟧', clip)
		);
	});
