/**
 * plugin-testing.md's "case that matters most": a document authored with the directive
 * but with the plugin not registered still round-trips byte for byte through the
 * generic fallback, so uninstalling never corrupts a saved document. Activates
 * directives only; never installs the admonition kind.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { parse, serialize } from '$lib';
import { activateDirectives } from '$lib/plugin';

beforeEach(() => {
	activateDirectives();
});

describe('unregistered-plugin fallback round-trip', () => {
	const cases = [
		':::note\nBody.\n:::\n',
		':::warning Careful\nLine one.\n\nLine two.\n:::\n',
		'# Heading\n\n:::tip Titled\nInside.\n:::\n\nAfter.\n'
	];
	for (const src of cases) {
		it(`round-trips ${JSON.stringify(src)} via the generic fallback`, () => {
			const doc = parse(src);
			expect(doc.children.map((node) => node.kind)).toContain('directiveContainer');
			expect(doc.children[0].kind).not.toBe('admonition');
			expect(serialize(doc)).toBe(src);
		});
	}
});
