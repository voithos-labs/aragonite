// @vitest-environment jsdom
// A paste of nothing over a range commits nothing, so no commit runs to clear the transient caret
// state behind it; the replace's own resets are the only ones on that path.
import { describe, it, expect } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { makeEnv, makeHandlers } from './typed-char-env';

const SOURCE = 'para A\n\npara B\n\npara C\n';

describe('a cross-block paste with an empty payload', () => {
	it('writes nothing and still forgets how the caret arrived', async () => {
		const env = makeEnv(SOURCE);
		env.selectionState.enterCrossBlock({ path: [0], offset: 2 }, { path: [2], offset: 3 });

		expect(
			await makeHandlers(env, [0]).pasteOverRange({
				text: '',
				plain: false,
				asksRewrites: 'blocks'
			})
		).toBe(false);

		expect(serialize(env.doc)).toBe(SOURCE);
		expect(env.caretMemory.forget).toHaveBeenCalled();
	});
});
