import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { createGrammarView } from '#lib/schema/block-openers.js';
import { makeNestedHarness } from '#lib/test/harness/editor-actions.js';

// The nested factory must pass deps.grammar as the top-level one does, or a disabled kind's
// opener typed inside a container creates that kind anyway.

function driveTypeInContainer(grammar: ReturnType<typeof createGrammarView> | undefined) {
	const doc = parse('> para\n');
	const { deps, bundle } = makeNestedHarness([doc.children[0]], { grammar });
	return { deps, bundle };
}

describe('nested updateBlockContent honors the instance grammar', () => {
	it('a disabled heading opener leaves a typed marker line a paragraph', async () => {
		const { deps, bundle } = driveTypeInContainer(createGrammarView((kind) => kind !== 'heading'));
		expect(deps.doc.children[0].children?.[0].kind).toBe('paragraph');

		await bundle.blockEdit.updateBlockContent(0, '# x\n', 'authored', 0);

		expect(deps.doc.children[0].children?.[0].kind).toBe('paragraph');
	});

	// Control: without an instance grammar the same line does become a heading.
	it('the global grammar still materializes the heading', async () => {
		const { deps, bundle } = driveTypeInContainer(undefined);

		await bundle.blockEdit.updateBlockContent(0, '# x\n', 'authored', 0);

		expect(deps.doc.children[0].children?.[0].kind).toBe('heading');
	});
});
