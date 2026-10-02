// @vitest-environment jsdom
// The defensive branch in the range replace that consumes a paste and inserts nothing: the removal
// wrote, but left no caret for the paste to go to.
import { describe, it, expect, vi } from 'vitest';
import { serialize } from '$lib/core/serializer';
import type { EditorError } from '$lib/editor-events';
import { makeEnv, makeHandlers, makePasteEvent } from './typed-char-env';

const SOURCE = 'para A\n\npara B\n\npara C\n';

describe('a cross-block paste whose removal resolves no caret', () => {
	it('reports on the error channel instead of dropping the payload silently', async () => {
		const env = makeEnv(SOURCE);
		const errors: EditorError[] = [];
		env.events.on('error', (e) => errors.push(e));
		// A removal that writes without leaving a caret behind.
		vi.spyOn(env.controller, 'commitMultiScope').mockResolvedValue(true);
		env.selectionState.enterCrossBlock({ path: [0], offset: 2 }, { path: [2], offset: 3 });

		expect(await makeHandlers(env, [0]).handlePaste(makePasteEvent('DROPPED'))).toBe(true);

		expect(serialize(env.doc)).not.toContain('DROPPED');
		expect(errors.map((e) => e.origin)).toEqual(['clipboard']);
		expect(String((errors[0].error as Error).message)).toContain('no caret');
		// The range start: a report naming nothing would leave a host unable to say where the
		// paste it must compensate for was aimed.
		expect(errors[0].context?.path).toEqual([0]);
	});
});

// The empty-payload return commits nothing, so no commit runs to clear the transient caret state
// behind it; the replace's own resets are the only ones on that path.
describe('a cross-block paste with an empty payload', () => {
	it('consumes the event and still forgets how the caret arrived', async () => {
		const env = makeEnv(SOURCE);
		env.selectionState.enterCrossBlock({ path: [0], offset: 2 }, { path: [2], offset: 3 });

		expect(await makeHandlers(env, [0]).handlePaste(makePasteEvent(''))).toBe(true);

		expect(serialize(env.doc)).toBe(SOURCE);
		expect(env.caretMemory.forget).toHaveBeenCalled();
	});
});
