// @vitest-environment jsdom
// A paste over a range across blocks writes the line ending the document held before the gesture,
// though the removal that comes first took every line ending it had.
// Miss-analysis: the CRLF paste rows kept a line ending outside the range, so the paste after the
// removal could still read the document's ending off what was left.
import { describe, it, expect } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { makeEnv, makeHandlers } from './typed-char-env';

describe('a paste over a range that takes every line ending of a CRLF document', () => {
	it.each([
		['lines of text', 'a\nb', 'oa\r\nbo'],
		['blocks', 'a\n\nb', 'oa\r\n\r\nbo']
	])('%s land with CRLF', async (_, clip, after) => {
		const env = makeEnv('one\r\n\r\ntwo');
		env.selectionState.enterCrossBlock({ path: [0], offset: 1 }, { path: [1], offset: 2 });

		await makeHandlers(env, [0]).pasteOverRange({ text: clip, plain: false });

		expect(serialize(env.doc)).toBe(after);
	});
});
