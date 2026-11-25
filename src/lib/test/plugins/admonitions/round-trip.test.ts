import { describe, it, expect, beforeEach } from 'vitest';
import { parse as parseDoc, serialize } from '#lib';
import { getPluginMetadata, rowContentRange, type CstNode } from '#lib/plugin.js';
import { convertGithubAlerts } from '#packages/admonitions/src/index.js';
import type { AdmonitionData } from '#packages/admonitions/src/kinds.js';
import { roundTripCases } from '#lib/test/harness/round-trip.js';
import { ADMONITION, admonitionsGrammar } from '#lib/test/support/admonitions-grammar.js';

let grammar: ReturnType<typeof admonitionsGrammar>;
const parse = (source: string) => parseDoc(source, { grammar });

beforeEach(() => {
	grammar = admonitionsGrammar();
});

function titleOf(node: CstNode): string {
	const { start, end } = rowContentRange(node);
	return node.children![0].raw.slice(start, end);
}

describe('admonition round-trip (registered)', () => {
	roundTripCases(
		[
			':::note\nBody.\n:::\n',
			':::tip Pro tip\nBody.\n:::\n',
			':::warning Careful\nLine one.\n\nLine two.\n:::\n',
			':::important\nA\n:::\n',
			':::caution\nDanger.\n:::\n',
			'# Heading\n\n:::note Titled\nInside.\n:::\n\nAfter.\n',
			'::::note\n:::tip\nnested inner directive stays body\n:::\n::::\n'
		],
		() => grammar
	);

	it('parses to the admonition kind and reads its name from metadata', () => {
		const doc = parse(':::warning Careful\nBody.\n:::\n');
		const node = doc.children[0];
		expect(node.kind).toBe(ADMONITION);
		expect(getPluginMetadata<AdmonitionData>(node)?.name).toBe('warning');
	});

	it('places the opener line in child 0 and the body in children 1+', () => {
		const doc = parse(':::tip Pro tip\nBody paragraph.\n:::\n');
		const node = doc.children[0];
		expect(node.children?.[0].kind).toBe('directiveOpenerLine');
		expect(node.children?.[0].raw).toBe(':::tip Pro tip\n');
		expect(node.children?.[1].kind).toBe('paragraph');
	});

	// Miss-analysis: every title was spaced with ASCII, never a typed non-breaking space.
	it('keeps the opener line as typed, its title past the name and its spaces', () => {
		const spaced = parse(':::tip \tPro tip\t\nBody.\n:::\n').children[0];
		expect(spaced.children?.[0].raw).toBe(':::tip \tPro tip\t\n');
		expect(titleOf(spaced)).toBe('Pro tip\t');
		const nbsp = parse(':::tip\u00a0Pro tip\nBody.\n:::\n').children[0];
		expect(titleOf(nbsp)).toBe('\u00a0Pro tip');
	});

	it('gives an untitled admonition an opener line with no title', () => {
		const doc = parse(':::note\nBody.\n:::\n');
		expect(doc.children[0].children?.[0].raw).toBe(':::note\n');
		expect(titleOf(doc.children[0])).toBe('');
	});
});

describe('GitHub-alert transform feeds a parseable admonition', () => {
	it('converts, parses to an admonition, and round-trips as the directive', () => {
		const { converted } = convertGithubAlerts('> [!WARNING]\n> Critical.\n> More.');
		const src = converted + '\n';
		const doc = parse(src);
		expect(doc.children[0].kind).toBe(ADMONITION);
		expect(getPluginMetadata<AdmonitionData>(doc.children[0])?.name).toBe('warning');
		expect(serialize(doc)).toBe(src);
	});
});
