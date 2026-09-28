// Miss-analysis: the convergence compare read a hand-kept list of built-in metadata fields, and
// every test drove a built-in kind, so none asked whether a plugin kind's metadata was compared.
import { beforeEach, describe, expect, it } from 'vitest';
import {
	parse,
	registerBlockOpener,
	setPluginMetadata,
	type CstNode,
	type PluginBlockKind
} from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import { assertParseConverged } from '$lib/testing/parse-convergence';
import { testLeaf } from '$lib/test/harness/test-kinds';

interface TagMetadata {
	tag: string;
	words: string[];
}

// `@@ alpha beta` parses to one leaf whose metadata holds the first word and the word list.
function registerTagKind(): PluginBlockKind {
	const kind = testLeaf('convergence-tag');
	registerBlockOpener(kind, {
		priority: 45,
		interruptsParagraph: false,
		tryOpen(ctx) {
			if (!ctx.line.text.startsWith('@@ ')) return null;
			const words = ctx.line.text.slice(3).split(' ');
			const node: CstNode = { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw };
			setPluginMetadata<TagMetadata>(node, { tag: words[0], words });
			return { node, consumed: 1 };
		}
	});
	return kind;
}

describe('parse convergence compares a plugin kind’s metadata', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerTagKind();
	});

	it('converges on a fresh parse, arrays compared by value', () => {
		expect(() => assertParseConverged(parse('@@ alpha beta\n'))).not.toThrow();
	});

	it('fails a live value its bytes no longer produce', () => {
		const doc = parse('@@ alpha beta\n');
		setPluginMetadata<TagMetadata>(doc.children[0], { tag: 'stale', words: ['alpha', 'beta'] });
		expect(() => assertParseConverged(doc)).toThrow(/convergence-tag\.tag: live "stale"/);
	});

	it('fails a key only the live node carries', () => {
		const doc = parse('@@ alpha beta\n');
		setPluginMetadata(doc.children[0], { tag: 'alpha', words: ['alpha', 'beta'], extra: 1 });
		expect(() => assertParseConverged(doc)).toThrow(/convergence-tag\.extra/);
	});
});
