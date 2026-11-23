// @vitest-environment jsdom
// A paste over a range across blocks reads the editor's own grammar, so the join's reparse
// honors what that editor switched on.
import { describe, it, expect } from 'vitest';
import { makeEnv, makeHandlers, selectAcross } from './typed-char-env';
import { fixtureReading } from '../../harness/fixture-grammar';
import { grammarWithout } from '#lib/test/harness/grammar-without.js';

// A cross-block paste whose collapsed caret lands at offset 0 of a `. item` block: pasting `1`
// completes the marker to `1. item`, and the join reparse must resolve through the grammar.
describe('a cross-block paste forwards the instance grammar to the join reparse', () => {
	it('a grammar that disables the list opener leaves the completion a paragraph', async () => {
		const grammar = grammarWithout('list');
		const env = makeEnv('x\n\n. item\n', fixtureReading({ grammar }));
		selectAcross(env.selectionState, [0], [1]);

		const handlers = makeHandlers(env, [0], { grammar });
		await handlers.pasteOverRange({ text: '1', plain: false, asksRewrites: true });

		expect(env.doc.children).toHaveLength(1);
		expect(env.doc.children[0].raw.trimEnd()).toBe('1. item');
		expect(env.doc.children[0].kind).toBe('paragraph');
	});

	// Control: with the global grammar (grammar undefined) the same paste re-creates the
	// list, so the assertion above is a real grammar effect, not a vacuous pass.
	it('the global grammar still re-creates the completion as a list', async () => {
		const env = makeEnv('x\n\n. item\n');
		selectAcross(env.selectionState, [0], [1]);

		const handlers = makeHandlers(env, [0]);
		await handlers.pasteOverRange({ text: '1', plain: false, asksRewrites: true });

		expect(env.doc.children[0].raw.trimEnd()).toBe('1. item');
		expect(env.doc.children[0].kind).toBe('list');
	});
});
