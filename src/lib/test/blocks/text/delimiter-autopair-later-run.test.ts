// @vitest-environment jsdom
// Miss-analysis: the auto-pair suites checked that a typed opener met no later closer, never that
// the twin it writes leaves the line's other runs paired as they were.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { resolveDelimiterAutoPair } from '#lib/components/blocks/text/delimiter-autopair.js';
import type { ContentRange } from '#lib/core/inline/index.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const type = (text: string, caret: number, typed: string, own: ContentRange | null = null) =>
	resolveDelimiterAutoPair(text, { start: 0, end: text.length }, caret, typed, fixtureReading(), {
		ownPair: own
	});

// A twin that would pair with a later run is not written; the browser types the key alone.
describe('the auto-pair writes no twin that pairs with a later run', () => {
	it.each([
		['*', 'a later strong run', '*a `b` **c***', 3],
		['*', 'a later lone star', 'x b* c', 2],
		['** (the second key)', 'a later strong run', '*a *`b` **c***', 4],
		['_', 'a later strong run', '_a `b` __c___', 3],
		['_', 'a later lone underscore', 'x b_ c', 2],
		['~~ (the second key)', 'a later single-tilde strike', 'a ~b~ c', 3],
		['`', 'a later double-backtick span', 'x  ``y`` z', 1]
	])('%s before %s', (key, _later, text, caret) => {
		expect(type(text, caret, key[0])).toBeNull();
	});
});

describe('the auto-pair still writes its twin where the line keeps its runs', () => {
	it.each([
		['*', 'a later strong run', 'x `b` **c**', 2, 'x **`b` **c**'],
		['*', 'a later emphasis', 'a *b*', 0, '**a *b*'],
		['_', 'a later strong run', 'x `b` **c**', 2, 'x __`b` **c**'],
		['~~ (the second key)', 'a later strong run', 'a ~b **c**', 3, 'a ~~~~b **c**'],
		['~~ (the second key)', 'a later strike', 'a ~b ~~c~~', 3, 'a ~~~~b ~~c~~'],
		['`', 'a later strong run', 'x **y** z', 2, 'x ``**y** z'],
		['`', 'a later code span', 'x  `y` z', 1, 'x``  `y` z']
	])('%s before %s', (key, _later, text, caret, paired) => {
		expect(type(text, caret, key[0])).toMatchObject({ kind: 'write', text: paired });
	});
});

/** `after` is `before` plus one `typed` byte somewhere: the key, and nothing the editor added. */
function holdsOneTypedByte(before: string, after: string, typed: string): boolean {
	if (after.length !== before.length + 1) return false;
	for (let i = 0; i < after.length; i++) {
		if (after[i] === typed && after.slice(0, i) + after.slice(i + 1) === before) return true;
	}
	return false;
}

describe('a typed delimiter whose twin would pair with a later run, mounted', () => {
	for (const mode of ['source', 'live'] as PresentationMode[])
		it.each([
			['*', '*a `b` **c***\n', 3],
			['_', '_a `b` __c___\n', 3],
			['`', 'x  ``y`` z\n', 1]
		])(`${mode}: %s in %j writes the key alone`, async (key, source, caret) => {
			const editor = mountEditor({ source, presentationMode: mode });
			await editor.settle();
			placeCaret(surfaceAt(editor, [0]), caret);
			await editor.settle();

			await pressHardwareKey(document.activeElement as HTMLElement, { key });
			await editor.settle();

			expect(holdsOneTypedByte(source, editor.source(), key)).toBe(true);
			expect(takeDevWarns().map((warn) => warn.tag)).toEqual([]);
		});
});
