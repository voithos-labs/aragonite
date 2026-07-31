import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse } from '$lib';
import { getPluginMetadata } from '$lib/plugin';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import type { GithubAlertMetadata } from '$lib/plugins/admonitions/kinds';
import { roundTripCases } from '$lib/test/support/round-trip';

// Native GitHub alerts: a blockquote whose FIRST line is exactly `> [!TYPE]` becomes
// its own `githubAlert` kind, with the marker line in the container raw + metadata
// only. Every NON-alert blockquote must still parse plain.

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

const firstKind = (src: string) => parse(src).children[0].kind;
const alertType = (src: string) =>
	getPluginMetadata<GithubAlertMetadata>(parse(src).children[0])?.alertType;

describe('github alert — the marker grammar claims a githubAlert', () => {
	it('parses a first-line marker to the githubAlert kind', () => {
		expect(firstKind('> [!NOTE]\n> Body.\n')).toBe('githubAlert');
	});

	it('recognizes all five types, preserving the typed casing in metadata', () => {
		for (const typed of ['NOTE', 'Tip', 'important', 'WARNING', 'Caution']) {
			const src = `> [!${typed}]\n> x\n`;
			expect(firstKind(src)).toBe('githubAlert');
			expect(alertType(src)).toBe(typed);
		}
	});

	it('keeps the marker out of the children (body starts after the marker line)', () => {
		const node = parse('> [!NOTE]\n> First para.\n>\n> Second.\n').children[0];
		expect(node.children?.map((c) => c.kind)).toEqual(['paragraph', 'paragraph']);
		expect(node.children?.[0].raw).toBe('First para.\n');
		expect(node.children?.[1].raw).toBe('Second.\n');
	});

	it('claims a marker-only alert with an empty body', () => {
		const node = parse('> [!TIP]\n').children[0];
		expect(node.kind).toBe('githubAlert');
		expect(node.children ?? []).toEqual([]);
	});

	it('carries lazy-continuation lines into the body (blockquote extent)', () => {
		const node = parse('> [!NOTE]\n> quoted\nlazy tail\n').children[0];
		expect(node.kind).toBe('githubAlert');
		expect(node.children?.[0].raw).toBe('quoted\nlazy tail\n');
	});
});

describe('github alert — MARKER whitespace edges', () => {
	// The edges MARKER's regex flags imply but no other case reaches, so a tightening
	// of the spacing rule cannot slip through green.

	it('accepts trailing whitespace after the `]`', () => {
		expect(firstKind('> [!NOTE]   \n> x\n')).toBe('githubAlert');
		expect(firstKind('> [!NOTE]\t\n> x\n')).toBe('githubAlert');
	});

	for (const { name, marker } of [
		{ name: 'no space after `>`', marker: '>[!NOTE]' },
		{ name: 'a tab after `>`', marker: '>\t[!NOTE]' }
	]) {
		it(`accepts ${name}`, () => {
			expect(firstKind(`${marker}\n> x\n`)).toBe('githubAlert');
		});
	}
});

describe('github alert — the CommonMark block-indent boundary', () => {
	// 4+ spaces makes a line indented code, so `blockquoteExtent` refuses it. A marker
	// regex accepting the indent anyway consumes nothing and hangs the parse loop.

	it('claims a marker indented up to three spaces', () => {
		expect(firstKind('   > [!NOTE]\n   > body\n')).toBe('githubAlert');
	});

	for (const { name, source, kinds } of [
		{ name: 'tab-indented marker', source: '\t> [!NOTE]\n', kinds: ['indentedCode'] },
		{
			name: 'four-space-indented marker',
			source: 'Example:\n\n    > [!NOTE]\n    > body\n',
			kinds: ['paragraph', 'indentedCode']
		}
	]) {
		it(`leaves a ${name} as indented code`, () => {
			expect(parse(source).children.map((c) => c.kind)).toEqual(kinds);
		});
	}

	it('lets an over-indented marker continue a paragraph instead of interrupting it', () => {
		expect(parse('Intro\n\t> [!NOTE]\n').children.map((c) => c.kind)).toEqual(['paragraph']);
	});

	roundTripCases([
		{ name: 'tab-indented marker', source: '\t> [!NOTE]\n' },
		{ name: 'four-space-indented marker', source: 'Example:\n\n    > [!NOTE]\n    > body\n' },
		{ name: 'three-space-indented marker', source: '   > [!NOTE]\n   > body\n' }
	]);
});

describe('github alert — non-alert blockquotes stay plain', () => {
	const declines = [
		{ name: 'mid-quote marker (not the first line)', src: '> plain\n> [!NOTE]\n> more\n' },
		{ name: 'marker with trailing text', src: '> [!NOTE] and more\n' },
		{ name: 'unknown type', src: '> [!DANGER]\n> x\n' },
		{ name: 'plain blockquote', src: '> just a quote\n' }
	];
	for (const { name, src } of declines) {
		it(`leaves a ${name} as a blockquote`, () => {
			expect(firstKind(src)).toBe('blockquote');
		});
	}
});
