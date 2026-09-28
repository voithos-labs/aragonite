// Miss-analysis: every re-read test compared metadata by value, so none noticed a re-read that
// replaced an unchanged object and re-ran everything reading it.
import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins, parse } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { adoptParsedMetadata } from '$lib/schema/container-raw';

beforeEach(() => {
	installPlugins([admonitionsPlugin()]);
});

describe('adoptParsedMetadata', () => {
	it('keeps the metadata object when no key changed', () => {
		const node = parse(':::spoiler\nhidden\n:::\n').children[0];
		const before = node.metadata;

		expect(adoptParsedMetadata(node, parse(node.raw).children)).toBe(true);
		expect(node.metadata).toBe(before);
	});

	it('takes the parse’s object when a key changed', () => {
		const node = parse(':::spoiler\nhidden\n:::\n').children[0];
		const reparsed = parse('::::spoiler\nhidden\n::::\n').children;

		expect(adoptParsedMetadata(node, reparsed)).toBe(true);
		expect(node.metadata).toBe(reparsed[0].metadata);
	});

	it('takes nothing from a parse of another kind', () => {
		const node = parse(':::spoiler\nhidden\n:::\n').children[0];
		const before = node.metadata;

		expect(adoptParsedMetadata(node, parse('plain\n').children)).toBe(false);
		expect(node.metadata).toBe(before);
	});
});
