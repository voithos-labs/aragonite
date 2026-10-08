import { describe, it, expect } from 'vitest';
import { installPlugins, parse } from '#lib';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import {
	activateDirectives,
	registerDirective,
	type CstNode,
	type ParsedDirective
} from '#lib/plugin.js';
import { testContainer } from '#lib/test/harness/test-kinds.js';

/** Admonitions registers its directive names only where no other plugin already holds one. */

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

describe('admonitions directive-name arbitration', () => {
	it('leaves a name claimed before it installed to the first claimant', () => {
		claimNoteDirective();
		installPlugins([admonitionsPlugin()]);
		expect(parse(':::note\nbody\n:::\n').children[0].kind).toBe(PROBE);
	});

	it('still claims its remaining names alongside the foreign one', () => {
		claimNoteDirective();
		installPlugins([admonitionsPlugin()]);
		expect(parse(':::tip\nbody\n:::\n').children[0].kind).toBe('admonition');
	});

	it('claims the name itself when nothing registered it first', () => {
		installPlugins([admonitionsPlugin()]);
		expect(parse(':::note\nbody\n:::\n').children[0].kind).toBe('admonition');
	});
});
