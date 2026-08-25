import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins, parse } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import {
	activateDirectives,
	declarePluginKind,
	registerBlockKind,
	registerDirective,
	type CstNode,
	type ParsedDirective
} from '$lib/plugin';
import { testClosure } from '$lib/test/support/closure';

/**
 * Admonitions registers five directive names and leaves alone any already registered.
 * Held here rather than by co-registering two claimants on a dev route: the winner is then
 * decided by process install order, which a multi-route SSR server and a fresh browser
 * realm resolve differently.
 */

const PROBE = 'directiveYieldProbe';

function claimNoteDirective(): void {
	activateDirectives();
	const kind = declarePluginKind(PROBE);
	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		container: { contract: 'opaque', rebuildRaw: () => {} }
	});
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
