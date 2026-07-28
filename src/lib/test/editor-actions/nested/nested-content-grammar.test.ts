import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { createGrammarView } from '$lib/schema/block-openers';
import { makeNestedHarness } from '../../harness/editor-actions';

// The nested content-commit reparse must honor the instance grammar, matching the
// top-level factory (which threads deps.grammar). Without it, typing a disabled
// kind's opener inside a container materializes that kind regardless of the
// instance's enablement — the C-F1 sibling-path gap.

function driveTypeInContainer(grammar: ReturnType<typeof createGrammarView> | undefined) {
	const doc = parse('> para\n'); // blockquote → child 0 is a paragraph
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

	// Positive control: with the global grammar the same typing DOES materialize the
	// heading, so the assertion above is not vacuously passing.
	it('the global grammar still materializes the heading', async () => {
		const { deps, bundle } = driveTypeInContainer(undefined);

		await bundle.blockEdit.updateBlockContent(0, '# x\n', 0);

		expect(deps.doc.children[0].children?.[0].kind).toBe('heading');
	});
});
