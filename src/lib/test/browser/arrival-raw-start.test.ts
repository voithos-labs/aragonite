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
import type { Document } from '#lib/core/nodes.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const SOURCE = '# Heading\n\n:::tip Title\nbody\n:::\n\n:::tip\nbody\n:::\n';

it.each([
	['live', 'a titled opener line', [1, 0], 7],
	['live', 'an untitled opener line', [2, 0], 6],
	['source', 'a titled opener line', [1, 0], 0],
	['live', 'a heading, whose text starts past its marker', [0], 0],
	['live', 'a callout body paragraph', [1, 1], 0]
] as const)('%s mode, %s: %j starts at %i', async (mode, _what, path, start) => {
	const editor = mountEditor<{ getDocument(): Document }>({
		source: SOURCE,
		presentationMode: mode,
		plugins: [admonitionsPlugin()]
	});
	await editor.settle();
	const node = blockNodeAt(editor.instance.__test.getDocument(), [...path])!;
	expect(arrivalRawStart(surfaceAt(editor, [...path]), node)).toBe(start);
});
