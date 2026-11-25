// An editor listing admonitions reads its five names as boxes even where a `setup` plugin registered
// one of them page-wide, which only an editor not listing admonitions still reads as its own.
// Miss-analysis: the package's `setup` registration yielded a name another plugin held first, and
// once its names were the editor's own nothing said which of the two answered.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib';
import {
	activateDirectives,
	registerDirective,
	type CstNode,
	type ParsedDirective
} from '#lib/plugin.js';
import { testContainer } from '#lib/test/harness/test-kinds.js';
import { ADMONITION, admonitionsGrammar } from '#lib/test/support/admonitions-grammar.js';

const PROBE = 'directiveYieldProbe';

function claimNoteDirective(): void {
	activateDirectives();
	const kind = testContainer(PROBE, { rebuildRaw: () => {} });
	registerDirective('container', 'note', {
		kind,
		fromDirective: (parsed: ParsedDirective): CstNode => ({
			kind,
			leadingTrivia: parsed.leadingTrivia,
			raw: parsed.raw,
			children: []
		})
	});
}

describe('a name a `setup` plugin registered page-wide', () => {
	it('reads as a box in an editor listing admonitions', () => {
		claimNoteDirective();
		const grammar = admonitionsGrammar();
		expect(parse(':::note\nbody\n:::\n', { grammar }).children[0].kind).toBe(ADMONITION);
		expect(parse(':::tip\nbody\n:::\n', { grammar }).children[0].kind).toBe(ADMONITION);
	});

	it('stays the plugin’s in an editor that lists no admonitions', () => {
		claimNoteDirective();
		expect(parse(':::note\nbody\n:::\n').children[0].kind).toBe(PROBE);
	});
});
