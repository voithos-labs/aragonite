import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { isBlockKindRegistered } from '#lib/schema/block-kind-descriptor.js';
import { admonitions } from '#packages/admonitions/src/index.js';
import { details } from '#packages/details/src/index.js';
import { footnotes } from '#packages/footnotes/src/index.js';
import { syntaxGrammar } from '../support/syntax-grammar';
import SHOWCASE_DOCUMENT from '../../../../examples/showcase/showcase-content.md?raw';

/**
 * The `/` showcase is the broadest realistic document in the repo and the first thing a
 * visitor edits, so a construct in it that fails to round-trip reaches a consumer rather than
 * CI. A unit case by necessity: the route exposes no `window.__test` bridge, and no single
 * page load installs all the bundled plugins.
 */

const KINDS = [
	'footnotes/definition',
	'details/details',
	'admonitions/admonition',
	'admonitions/alert'
];

let grammar: GrammarView;
beforeEach(() => {
	grammar = syntaxGrammar([admonitions, details, footnotes]);
});

describe('showcase document', () => {
	// Without this the round trip below would pass with every install having silently failed:
	// the plain grammar round-trips most of these bytes as prose.
	it('installed the plugin grammar the document is written against', () => {
		for (const kind of KINDS) {
			expect(isBlockKindRegistered(kind), `plugin kind not registered: ${kind}`).toBe(true);
		}
	});

	it('round-trips byte-for-byte under the showcase plugin set', () => {
		expect(serialize(parse(SHOWCASE_DOCUMENT, { grammar }))).toBe(SHOWCASE_DOCUMENT);
	});

	it('resolves the plugin constructs to plugin kinds, not fallback prose', () => {
		const doc = parse(SHOWCASE_DOCUMENT, { grammar });
		const kinds = new Set<string>(doc.children.map((block) => block.kind));
		for (const kind of KINDS) {
			expect(kinds.has(kind), `showcase construct fell back to prose: ${kind}`).toBe(true);
		}
	});
});
