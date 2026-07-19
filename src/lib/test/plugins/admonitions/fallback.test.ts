/**
 * The case plugin-guide §6 calls "the case that matters most": a document
 * authored with the directive but with the plugin NOT registered must still
 * round-trip byte-for-byte through the generic fallback — so uninstalling the
 * plugin never corrupts a saved document. This file activates directives only;
 * it never installs the admonition kind.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse, serialize } from '$lib';
import { activateDirectives } from '$lib/plugin';

beforeAll(() => {
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
			expect(doc.children[0].kind).not.toBe('admonition');
			expect(serialize(doc)).toBe(src);
		});
	}
});
