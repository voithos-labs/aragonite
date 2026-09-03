import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from '$lib/core/parser';
import { installPlugins } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { getAllRegisteredKinds } from '$lib/schema/block-kind-descriptor';
import {
	ALL_BLOCK_KINDS,
	isBuiltinBlockKind,
	type CstNode,
	type Document,
	type InlineNode
} from '$lib/core/nodes';
import { computeInlineContent, isProseKind } from '$lib/plugin';
import { ADMONITION, GITHUB_ALERT } from '$lib/plugins/admonitions/kinds';
import { DETAILS } from '$lib/plugins/details';
import { EMOJI_KIND } from '$lib/plugins/emoji';
import { FOOTNOTE_DEF_KIND, FOOTNOTE_REF_KIND } from '$lib/plugins/footnotes';
import { MATH_BLOCK, MATH_INLINE } from '$lib/plugins/latex';
import { MERMAID } from '$lib/plugins/mermaid';
import { PARROT } from '$lib/plugins/parrot';
import { TOC_BLOCK } from '$lib/plugins/toc';
import { DEMO_PLUGINS } from '../../../routes/demo-plugins';
import SHOWCASE_DOCUMENT from '../../../routes/showcase-content.md?raw';

/**
 * What the `/` tour demonstrates, derived from the registries rather than from the
 * document's prose: the owner rewrites `showcase-content.md` by hand, and a suite that
 * pins its sentences reds on every rewrite while saying nothing about coverage.
 */

/** A kind the tour does not reach today. Both directions are asserted, so an entry
 *  whose kind is demonstrated, or names nothing expected, fails. */
const NOT_YET_DEMONSTRATED: Record<string, string> = {
	// Gaps the owner can close by editing the document.
	mermaid:
		'GAP: the document holds no ```mermaid fence, so the bundled mermaid plugin never renders on the tour',
	mathFence: 'GAP: block math is written as `$$…$$` only; the ```math fence form is unshown',
	setextHeading: 'GAP: every heading is ATX; the underlined form is unshown',
	indentedCode: 'GAP: code is fenced throughout; the four-space form is unshown',
	linkReferenceDefinition: 'GAP: every link is inline; the reference form is unshown',
	// Kinds a finished tour must NOT contain.
	htmlBlock:
		'BY DESIGN: the only raw HTML is the `<details>` block, which the details plugin claims',
	unrecognized: 'BY DESIGN: the parser mints this for input it cannot place; a valid tour has none',
	directiveContainer:
		'BY DESIGN: the `:::name` fallback for a name no plugin claims; the tour shows claimed names',
	directiveLeaf: 'BY DESIGN: the leaf half of the same unclaimed-directive fallback'
};

/** Bundled plugin directory → a kind whose presence proves its syntax is on the tour.
 *  Lockstepped against the directory listing below, so a plugin dropped from the demo
 *  set fails here even though its kinds leave the registry with it. */
const PLUGIN_DEMONSTRATED_BY: Record<string, string[]> = {
	admonitions: [ADMONITION, GITHUB_ALERT],
	details: [DETAILS],
	emoji: [EMOJI_KIND],
	footnotes: [FOOTNOTE_DEF_KIND, FOOTNOTE_REF_KIND],
	latex: [MATH_BLOCK, MATH_INLINE],
	mermaid: [MERMAID],
	parrot: [PARROT],
	toc: [TOC_BLOCK],
	// Declares no kind at all: its demonstration is a paragraph repeating a word, asserted
	// on its own below and chosen the same way by `plugins/showcase-occurrences.spec.ts`.
	'highlight-occurrences': []
};

/** The inline kinds the bundled plugins mint. No registry lists them, so the plugin
 *  packages' own exported constants stand in. */
const PLUGIN_INLINE_KINDS = [EMOJI_KIND, FOOTNOTE_REF_KIND, MATH_INLINE];

function kindsIn(document: Document): Set<string> {
	const found = new Set<string>();
	const collectInline = (nodes: readonly InlineNode[]): void => {
		for (const node of nodes) {
			found.add(node.kind);
			if (node.children) collectInline(node.children);
		}
	};
	const walk = (nodes: readonly CstNode[]): void => {
		for (const node of nodes) {
			found.add(node.kind);
			if (isProseKind(node.kind)) collectInline(computeInlineContent(node));
			if (node.children) walk(node.children);
		}
	};
	walk(document.children);
	return found;
}

let demonstrated: Set<string>;
let expected: Set<string>;

beforeAll(() => {
	resetPluginPlatformForTests();
	installPlugins(DEMO_PLUGINS);
	demonstrated = kindsIn(parse(SHOWCASE_DOCUMENT));
	expected = new Set([
		...ALL_BLOCK_KINDS,
		...getAllRegisteredKinds().filter((kind) => !isBuiltinBlockKind(kind)),
		...PLUGIN_INLINE_KINDS
	]);
});

afterAll(() => resetPluginPlatformForTests());

describe('the showcase document demonstrates the surface it ships with', () => {
	it('installs the plugin grammar it is written against', () => {
		// Vacuity guard: with no plugin kind registered the expected set is built-ins only
		// and every assertion below passes on a document that renders as prose.
		expect(expected.size).toBeGreaterThan(ALL_BLOCK_KINDS.length + PLUGIN_INLINE_KINDS.length);
	});

	it('holds a node of every kind the demo installs', () => {
		const missing = [...expected].filter(
			(kind) => !demonstrated.has(kind) && !(kind in NOT_YET_DEMONSTRATED)
		);
		expect(
			missing,
			`kinds the tour installs but never shows — demonstrate them in showcase-content.md, or list them in NOT_YET_DEMONSTRATED with a reason:\n  ${missing.join('\n  ')}`
		).toEqual([]);
	});

	it('lists no gap the tour has since closed', () => {
		const closed = Object.keys(NOT_YET_DEMONSTRATED).filter((kind) => demonstrated.has(kind));
		expect(
			closed,
			`NOT_YET_DEMONSTRATED entries the document now demonstrates (drop them — the list only shrinks):\n  ${closed.join('\n  ')}`
		).toEqual([]);
	});

	it('lists no gap for a kind the demo does not install', () => {
		const dangling = Object.keys(NOT_YET_DEMONSTRATED).filter((kind) => !expected.has(kind));
		expect(
			dangling,
			`NOT_YET_DEMONSTRATED entries naming a kind nothing installs, so the gap they report is unreadable:\n  ${dangling.join('\n  ')}`
		).toEqual([]);
	});

	// The registry cannot see a plugin that LEFT the demo set: its kinds leave the expected
	// set with it, and every assertion above stays green on a tour that lost a plugin.
	it.each(Object.entries(PLUGIN_DEMONSTRATED_BY))(
		'the %s plugin has something to show',
		(dir, kinds) => {
			expect(
				kinds.filter((kind) => !expected.has(kind)),
				`${dir} names kinds the demo set does not install`
			).toEqual([]);
			const unshown = kinds.filter(
				(kind) => !demonstrated.has(kind) && !(kind in NOT_YET_DEMONSTRATED)
			);
			expect(unshown, `${dir} installs kinds the document never uses`).toEqual([]);
		}
	);

	it('gives the kind-less occurrence plugin a paragraph to work on', () => {
		const repeated = parse(SHOWCASE_DOCUMENT).children.filter(
			(block) => block.kind === 'paragraph' && repeatedWord(block.raw) !== null
		);
		expect(
			repeated.length,
			'no paragraph repeats a four-letter word, so a caret has nothing to light up'
		).toBeGreaterThan(0);
	});

	it('enrolls every bundled plugin directory, and only those', () => {
		const dirs = readdirSync(path.resolve('src/lib/plugins'), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
		const enrolled = Object.keys(PLUGIN_DEMONSTRATED_BY);
		expect(
			dirs.filter((dir) => !enrolled.includes(dir)),
			'bundled plugins the tour never claims to demonstrate'
		).toEqual([]);
		expect(
			enrolled.filter((dir) => !dirs.includes(dir)),
			'entries with no plugin directory'
		).toEqual([]);
	});
});

/** The first word of four letters or more a paragraph repeats — `showcase-occurrences.spec.ts`
 *  picks its click target the same way, over the same tokenization the plugin scans with. */
function repeatedWord(raw: string): string | null {
	const counts = new Map<string, number>();
	for (const [token] of raw.matchAll(/[\p{L}\p{N}_]+/gu)) {
		if (!/^[A-Za-z]{4,}$/.test(token)) continue;
		counts.set(token, (counts.get(token) ?? 0) + 1);
	}
	for (const [word, count] of counts) if (count >= 2) return word;
	return null;
}
