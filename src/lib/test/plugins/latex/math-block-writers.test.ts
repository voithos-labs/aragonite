// The writers of a new `$$` block outside the Enter completer (`typed-completion.test.ts` pins
// that one): each builds its bytes from `mathBlockLines` and writes what it always has.
import { describe, expect, it } from 'vitest';
import { installPlugins, parse } from '#lib';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { insertCatalogue } from '#lib/schema/insert-catalogue.js';
import { latexPlugin } from '#lib/plugins/latex/index.js';

describe('a new $$ block is written as it always was', () => {
	it('by the insert menu', () => {
		installPlugins([latexPlugin()]);
		const entry = insertCatalogue({ isActive: () => true }).find((e) => e.id === 'math');
		expect(entry?.markdown).toBe('$$\n\n$$\n');
	});

	it('by the kind conformance kit’s fixture', () => {
		installPlugins([latexPlugin()]);
		const [node] = parse('$$\nx\n$$\n').children;
		expect(tryGetBlockKindDescriptor(node.kind)?.conformanceFixture).toBe('$$\nx^2\n$$\n');
	});
});
