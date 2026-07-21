import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse, serialize } from '$lib';
import { getPluginMetadata } from '$lib/plugin';
import { admonitionsPlugin, convertGithubAlerts } from '$lib/plugins/admonitions';
import type { AdmonitionMetadata } from '$lib/plugins/admonitions/kinds';
import { roundTripCases } from '$lib/test/support/round-trip';

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

describe('admonition round-trip (registered)', () => {
	roundTripCases([
		':::note\nBody.\n:::\n',
		':::tip Pro tip\nBody.\n:::\n',
		':::warning Careful\nLine one.\n\nLine two.\n:::\n',
		':::important\nA\n:::\n',
		':::caution\nDanger.\n:::\n',
		'# Heading\n\n:::note Titled\nInside.\n:::\n\nAfter.\n',
		'::::note\n:::tip\nnested inner directive stays body\n:::\n::::\n'
	]);

	it('parses to the admonition kind and reads its name from metadata', () => {
		const doc = parse(':::warning Careful\nBody.\n:::\n');
		const node = doc.children[0];
		expect(node.kind).toBe('admonition');
		expect(getPluginMetadata<AdmonitionMetadata>(node)?.name).toBe('warning');
	});

	it('places the title in child 0 and body in children 1+', () => {
		const doc = parse(':::tip Pro tip\nBody paragraph.\n:::\n');
		const node = doc.children[0];
		expect(node.children?.[0].kind).toBe('admonition-title');
		expect(node.children?.[0].raw).toBe('Pro tip\n');
		expect(node.children?.[1].kind).toBe('paragraph');
	});

	it('gives an untitled admonition an empty title leaf', () => {
		const doc = parse(':::note\nBody.\n:::\n');
		expect(doc.children[0].children?.[0].raw).toBe('\n');
	});
});

describe('GitHub-alert transform feeds a parseable admonition', () => {
	it('converts, parses to an admonition, and round-trips as the directive', () => {
		const { converted } = convertGithubAlerts('> [!WARNING]\n> Critical.\n> More.');
		const src = converted + '\n';
		const doc = parse(src);
		expect(doc.children[0].kind).toBe('admonition');
		expect(getPluginMetadata<AdmonitionMetadata>(doc.children[0])?.name).toBe('warning');
		expect(serialize(doc)).toBe(src);
	});
});
