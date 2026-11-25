// @vitest-environment jsdom
// The earliest offset an arriving caret rests at: a `:::` opener line's title start where the mode
// hides markers, and 0 for every other block and in source mode.
// Miss-analysis: the e2e guard mounts the opener line alone, so an answer given to every block with
// a marker left the guard green and turned one unrelated row red in 602.
import { afterEach, beforeAll, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { arrivalRawStart } from '#lib/browser/offsets.js';
import { getContentRange } from '#lib/core/inline/index.js';
import type { Document } from '#lib/core/nodes.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { registeredAdmonitions } from '#lib/test/harness/registered-admonitions.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const SOURCE =
	'# Heading\n\n:::tip Title\nbody\n:::\n\n:::tip\nbody\n:::\n\n' +
	'> :::tip Quoted title\n> in quote\n> :::\n\n:::tip  Two spaces\nbody\n:::\n';

async function mounted(mode: 'live' | 'source') {
	const editor = mountEditor<{ getDocument(): Document }>({
		source: SOURCE,
		presentationMode: mode,
		plugins: [registeredAdmonitions()]
	});
	await editor.settle();
	return editor;
}

it.each([
	['live', 'a titled opener line', [1, 0], 7],
	['live', 'an untitled opener line', [2, 0], 6],
	['live', 'an opener line in a quote, past its `> `', [3, 0, 0], 7],
	['live', 'an opener line with two spaces before its title', [4, 0], 8],
	['source', 'a titled opener line', [1, 0], 0],
	['live', 'a heading, whose text starts past its marker', [0], 0],
	['live', 'a callout body paragraph', [1, 1], 0]
] as const)('%s mode, %s: %j starts at %i', async (mode, _what, path, start) => {
	const editor = await mounted(mode);
	expect(arrivalRawStart(surfaceAt(editor, [...path]))).toBe(start);
});

// The predicate reads the row's marker off the element, so it must agree with the tree's own answer.
it.each([[[1, 0]], [[2, 0]], [[3, 0, 0]], [[4, 0]]] as const)(
	'live mode, the row at %j starts where the tree says its content does',
	async (path) => {
		const editor = await mounted('live');
		const node = blockNodeAt(editor.instance.__test.getDocument(), [...path])!;
		expect(arrivalRawStart(surfaceAt(editor, [...path]))).toBe(getContentRange(node).start);
	}
);
