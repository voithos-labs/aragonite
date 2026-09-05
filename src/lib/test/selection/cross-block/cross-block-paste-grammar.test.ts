// @vitest-environment jsdom
//
// The cross-block paste caller must forward the instance grammar onto the PasteDispatchContext it
// builds, so the join-paste reparse honors per-instance enablement.
// `test/tree-operations/paste/dispatch-commit.test.ts` proves the apply path honors a passed
// ctx.grammar; this proves the CALLER populates it.
import { describe, it, expect } from 'vitest';
import { createGrammarView } from '$lib/schema/block-openers';
import { makeEnv, makeHandlers, makePasteEvent, selectAcross } from './typed-char-env';

// A cross-block paste whose collapsed caret lands at offset 0 of a `. item` block: pasting `1`
// completes the marker to `1. item`, and the join reparse must resolve through the grammar.
describe('handleCrossBlockPaste forwards the instance grammar to the join reparse', () => {
	it('a grammar that disables the list opener leaves the completion a paragraph', async () => {
		const env = makeEnv('x\n\n. item\n');
		selectAcross(env.selectionState, [0], [1]);

		const handlers = makeHandlers(env, [0], {
			grammar: createGrammarView((kind) => kind !== 'list')
		});
		await handlers.handlePaste(makePasteEvent('1'));

		expect(env.doc.children).toHaveLength(1);
		expect(env.doc.children[0].raw.trimEnd()).toBe('1. item');
		expect(env.doc.children[0].kind).toBe('paragraph');
	});

	// Control: with the global grammar (grammar undefined) the same paste re-mints the
	// list, so the assertion above is a real grammar effect, not a vacuous pass.
	it('the global grammar still re-mints the completion as a list', async () => {
		const env = makeEnv('x\n\n. item\n');
		selectAcross(env.selectionState, [0], [1]);

		const handlers = makeHandlers(env, [0]);
		await handlers.handlePaste(makePasteEvent('1'));

		expect(env.doc.children[0].raw.trimEnd()).toBe('1. item');
		expect(env.doc.children[0].kind).toBe('list');
	});
});
