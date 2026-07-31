import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { createGrammarView } from '$lib/schema/block-openers';
import { makeNestedHarness } from '../../harness/editor-actions';

// Sibling-path parity with the top-level factory (which threads deps.grammar): without
// it, a disabled kind's opener typed inside a container materializes that kind anyway.

function driveTypeInContainer(grammar: ReturnType<typeof createGrammarView> | undefined) {
	const doc = parse('> para\n');
	const { deps, bundle } = makeNestedHarness([doc.children[0]], { grammar });
	return { deps, bundle };
}

describe('nested updateBlockContent honors the instance grammar', () => {
	it('a disabled heading opener leaves a typed marker line a paragraph', async () => {
		const { deps, bundle } = driveTypeInContainer(createGrammarView((kind) => kind !== 'heading'));
		expect(deps.doc.children[0].children?.[0].kind).toBe('paragraph');

		await bundle.blockEdit.updateBlockContent(0, '# x\n', 0);

		expect(deps.doc.children[0].children?.[0].kind).toBe('paragraph');
	});

	// Positive control: the assertion above is not vacuously passing.
	it('the global grammar still materializes the heading', async () => {
		const { deps, bundle } = driveTypeInContainer(undefined);

		await bundle.blockEdit.updateBlockContent(0, '# x\n', 0);

		expect(deps.doc.children[0].children?.[0].kind).toBe('heading');
	});
});
