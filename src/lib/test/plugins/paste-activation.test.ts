// @vitest-environment jsdom
// Miss-analysis: no test pasted a plugin kind's syntax into an editor that left it out (GH #267).
import { beforeEach, describe, it, expect } from 'vitest';
import { installPlugins } from '#lib';
import { parrotPlugin, PARROT } from '#packages/parrot/src/index.js';
import { normalizeReplacementForBody } from '#lib/tree-operations/paste/body-write.js';
import { declaredPluginKind } from '#lib/schema/plugin-kind.js';
import { DETAILS, registerDetailsKind } from '#packages/details/src/details-kind.js';
import type { CstNode } from '#lib/core/nodes.js';
import { createRegistryView } from '#lib/schema/registry-view.js';
import { defaultGrammarView, type GrammarView } from '#lib/schema/block-openers.js';
import { activationFor } from '#lib/schema/plugin-activation.js';
import { testView } from '#lib/test/harness/test-view.js';

const PARROT_LINE = '%%parrot party responsibly\n';

/** The grammar an editor whose `plugins` prop lists `names` parses through. */
function grammarListing(names: string[]) {
	return createRegistryView({ plugins: activationFor(names) }).grammar;
}

beforeEach(() => {
	installPlugins([parrotPlugin()]);
	// A bodyWrite-declaring owner, so the escape below has a reparse to run.
	registerDetailsKind(testView());
});

// The splice's own reparse: a `bodyWrite` container
// escapes the pasted bytes and re-reads them, so it has to use the grammar the clipboard used.
describe('the bodyWrite escape reparse reads the instance grammar', () => {
	const pasted = (): CstNode[] => [
		{ kind: 'paragraph', leadingTrivia: '', raw: PARROT_LINE + '</details>\n' } as CstNode
	];
	const landedKinds = (grammar: GrammarView) =>
		normalizeReplacementForBody(
			{ kind: declaredPluginKind(DETAILS), leadingTrivia: '', raw: '' } as CstNode,
			pasted(),
			'\n',
			grammar
		).replacement.map((n) => n.kind);

	it('the global grammar creates the plugin kind', () => {
		expect(landedKinds(defaultGrammarView)).toContain(PARROT);
	});

	it('the grammar of an editor without the plugin keeps it prose', () => {
		expect(landedKinds(grammarListing([]))).not.toContain(PARROT);
	});
});
