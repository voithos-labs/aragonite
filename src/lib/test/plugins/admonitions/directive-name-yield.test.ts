import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins, parse } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import {
	activateDirectives,
	registerDirective,
	type CstNode,
	type ParsedDirective
} from '$lib/plugin';
import { testContainer } from '$lib/test/harness/test-kinds';

/**
 * Admonitions registers five directive names and leaves alone any already registered.
 * Tested here rather than by installing two competing plugins on a dev route: the winner would
 * then depend on install order, which a multi-route server and a fresh browser page resolve
 * differently.
 */

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
	beforeEach(() => resetPluginPlatformForTests());

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
