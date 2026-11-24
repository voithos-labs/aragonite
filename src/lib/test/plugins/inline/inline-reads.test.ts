// @vitest-environment jsdom
// What an editor reads with `inline()` constructs on its list: the claim, its data, the built-in
// image or link an `as` claim makes and writes, the order on one character, and the install errors.
import { describe, expect, it, vi } from 'vitest';
import type { InlineNode } from '#lib';
import {
	INLINE_PRIORITIES,
	inline,
	type ViewportPoint,
	registerInlineSyntax,
	type ImagePiece,
	type Inline,
	type InlineSpec,
	type LinkPiece,
	type PluginError
} from '#lib/plugin.js';
import { readInline } from '#lib/core/inline/scan/index.js';
import { createEditorGrammar } from '#lib/schema/editor-grammar.js';
import { installOwnSyntax } from '#lib/schema/own-syntax.js';
import { buildImageEditBytes } from '#lib/core/inline/image-source-bytes.js';
import { buildLinkRetitleBytes, buildLinkUnwrapBytes } from '#lib/core/inline/link-source-bytes.js';
import { cutOutsideWhole, splitBehaviorOf } from '#lib/core/inline/live-edit/live-split.js';
import { parse } from '#lib/core/parser.js';
import { inlineTable } from '#lib/core/inline/scan/inline-table.js';
import {
	revealsOnArrow,
	revealsOnClick,
	type WidgetEditing
} from '#lib/core/inline/inline-widgets.js';
import { takeDevWarns, takeDevWarnsOf } from '#lib/test/support/warn-gate.js';
import { expectBoundedGrowth, measureScanGrowth } from '../../harness/scan-growth';

type Listing = readonly (readonly [plugin: string, inlines: readonly Inline<unknown>[]])[];

function editorReading(listing: Listing) {
	const reports: PluginError[] = [];
	const units = listing.map(([name, inlines]) => ({
		name,
		plugin: { name, version: '1.0.0', editor: '*' },
		contribution: { inlines }
	}));
	const { inlines } = installOwnSyntax(units, (error) => reports.push(error));
	const grammar = createEditorGrammar({ inlines: () => inlines });
	const read = (raw: string, end = raw.length) => readInline(raw, 0, end, undefined, grammar);
	return { grammar, read, reports };
}

const wikiWidget = () =>
	inline({
		name: 'note',
		label: 'Note',
		prefix: '[[',
		match: /\[\[([^\]\n]+)\]\]/,
		read: (m) => ({ target: m[1] }),
		sample: '[[note]]',
		widget: { delete: 'whole', arrows: 'into', click: 'follow' },
		draw: () => ({}),
		follow: () => {}
	});

const embed = (write?: (image: { src: string; width: number | null }) => string | null) =>
	inline({
		name: 'embed',
		label: 'Embed',
		prefix: '![[',
		match: /!\[\[([^\]|]+?)(?:\|(\d+))?\]\]/,
		read: (m) => ({ src: m[1], width: m[2] === undefined ? null : Number(m[2]) }),
		sample: '![[a.png]]',
		as: 'image',
		image: (d) => ({ src: d.src, alt: d.src, title: null, width: d.width, height: null }),
		...(write && { write: (image: ImagePiece) => write(image) })
	});

const wikiLink = (write = true) =>
	inline({
		name: 'link',
		label: 'Link',
		prefix: '[[',
		match: /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/,
		read: (m) => ({ target: m[1], text: m[2] ?? m[1] }),
		sample: '[[note|Shown]]',
		as: 'link',
		link: (d) => ({ href: d.target, text: d.text, title: null }),
		...(write && { write: (l: LinkPiece) => `[[${l.href}|${l.text}]]` })
	});

describe('inline(): what the editor reads', () => {
	it('reads [[note]] as the plugin construct, with the data `read` gave', () => {
		const { read } = editorReading([['wiki', [wikiWidget()]]]);
		const [, note] = read('a [[note]] b');
		expect(note).toEqual({ kind: 'wiki/note', start: 2, end: 10, data: { target: 'note' } });
	});

	it('reads ![[a]](https://x.dev) as the built-in image where an image construct is listed', () => {
		const { read } = editorReading([['embeds', [embed()]]]);
		const [image] = read('![[a]](https://x.dev)');
		expect(image).toMatchObject({ kind: 'image', alt: '[a]', url: 'https://x.dev' });
		expect(image.syntaxClaim).toBeUndefined();
		const [own] = read('![[a.png|300]]');
		expect(own).toMatchObject({ kind: 'image', url: 'a.png', width: 300 });
		expect(own.syntaxClaim?.prefix).toBe('![[');
	});

	it('two editors with different lists read the same bytes apart', () => {
		const listed = editorReading([['wiki', [wikiWidget()]]]);
		const unlisted = editorReading([]);
		const kinds = (nodes: InlineNode[]) => nodes.map((n) => n.kind);
		expect(kinds(listed.read('[[note]]'))).toEqual(['wiki/note']);
		expect(kinds(unlisted.read('[[note]]'))).not.toContain('wiki/note');
	});

	it('a function matcher claims what it returns, and `read` gets the claim', () => {
		const tag = inline({
			name: 'tag',
			label: 'Tag',
			prefix: '#',
			match: (text, at, end) => {
				let i = at + 1;
				while (i < end && /\w/.test(text[i])) i++;
				return i > at + 1 ? i : -1;
			},
			read: (claim) => claim.slice(1),
			sample: '#tag',
			class: 'tag'
		});
		const { read } = editorReading([['tags', [tag]]]);
		expect(read('a #tag b')[1]).toEqual({ kind: 'tags/tag', start: 2, end: 6, data: 'tag' });
		expect(read('a # b').map((n) => n.kind)).toEqual(['text']);
	});

	it('a regex reads only the range: a claim past its end is no claim, not a throw', () => {
		const { read } = editorReading([['wiki', [wikiWidget()]]]);
		expect(read('[[ab]] z', 4).map((n) => n.kind)).not.toContain('wiki/note');
	});

	it('an inline is tried before the registrar records on its character, then by `after`', () => {
		registerInlineSyntax(
			'[',
			(_raw, pos) => ({ kind: 'old-wiki' as InlineNode['kind'], start: pos, end: pos + 8 }),
			{ prefix: '[[', priority: INLINE_PRIORITIES.prefixOverride }
		);
		const first = wikiWidget();
		const second = inline({
			name: 'aaa',
			label: 'A',
			prefix: '[[',
			match: /\[\[[^\]]*\]\]/,
			read: () => 'second',
			sample: '[[x]]',
			after: first,
			class: 'a'
		});
		const { read } = editorReading([['wiki', [second, first]]]);
		expect(read('[[note]]')[0].kind).toBe('wiki/note');
	});
});

describe('inline(): an `as` claim writes through `write`', () => {
	const fields = (node: InlineNode) => ({ alt: node.alt!, url: node.url!, width: 420 });

	it('a resize writes the embed back in its own syntax', () => {
		const { read } = editorReading([['embeds', [embed((i) => `![[${i.src}|${i.width}]]`)]]]);
		const [node] = read('![[a.png|300]]');
		expect(buildImageEditBytes(node, '![[a.png|300]]', fields(node))).toBe('![[a.png|420]]');
	});

	it('an edit the piece cannot hold, a crop, is refused without asking `write`', () => {
		let asked = 0;
		const { read } = editorReading([['embeds', [embed(() => (asked++, 'x'))]]]);
		const [node] = read('![[a.png|300]]');
		const cropped = { ...fields(node), crop: { x: 50, y: 50, z: 1 } };
		expect(buildImageEditBytes(node, '![[a.png|300]]', cropped)).toBeNull();
		expect(asked).toBe(0);
		takeDevWarns();
	});

	it('without `write` a resize is refused', () => {
		const { read } = editorReading([['embeds', [embed()]]]);
		const [node] = read('![[a.png|300]]');
		expect(buildImageEditBytes(node, '![[a.png|300]]', fields(node))).toBeNull();
		takeDevWarns();
	});

	it('a link shows its text run, and the card writes through `write` or is refused', () => {
		const raw = '[[note|Shown]]';
		const withWrite = editorReading([['wiki', [wikiLink()]]]);
		const [link] = withWrite.read(raw);
		expect(link).toMatchObject({ kind: 'link', url: 'note' });
		expect(link.children).toMatchObject([{ kind: 'text', start: 7, end: 12, text: 'Shown' }]);
		const reading = { grammar: withWrite.grammar } as never;
		expect(buildLinkRetitleBytes(link, raw, 'Other', 'page', reading)).toBe('[[page|Other]]');
		const without = editorReading([['wiki', [wikiLink(false)]]]);
		const [bare] = without.read(raw);
		expect(buildLinkRetitleBytes(bare, raw, 'Other', 'page', reading)).toBeNull();
		takeDevWarns();
	});

	it('Remove link unwraps an `inline()` link to its text', () => {
		const raw = '[[note|Shown]]';
		const { read, grammar } = editorReading([['wiki', [wikiLink(false)]]]);
		const reading = { grammar, resolver: undefined, resolverSignature: '' } as never;
		expect(buildLinkUnwrapBytes(read(raw)[0], raw, reading)).toBe('Shown');
	});

	// Miss-analysis: every link row's text appeared once in its claim, so none asked which run of
	// the bytes is the text, and the first one won: a letter typed in the alias wrote the target.
	it('a link whose text also spells part of its target shows the run `at` names', () => {
		const aliased = (at: (target: string) => number) =>
			inline({
				name: 'link',
				label: 'Link',
				prefix: '[[',
				match: /\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/,
				read: (m) => ({ target: m[1], text: m[2], at: at(m[1]) }),
				sample: '[[note|Shown]]',
				as: 'link',
				link: (d) => ({ href: d.target, text: d.text, at: d.at, title: null })
			});
		const { read } = editorReading([['wiki', [aliased((target) => target.length + 3)]]]);
		expect(read('[[notebook|note]]')[0].children).toMatchObject([
			{ kind: 'text', start: 11, end: 15, text: 'note' }
		]);
		const wrong = editorReading([['wiki', [aliased(() => 3)]]]);
		expect(wrong.read('[[notebook|note]]').some((n) => n.syntaxClaim)).toBe(false);
	});

	it('a link whose text is not in its bytes is left to the editor', () => {
		const odd = inline({
			name: 'odd',
			label: 'Odd',
			prefix: '[[',
			match: /\[\[([^\]]+)\]\]/,
			read: (m) => m[1],
			sample: '[[x]]',
			as: 'link',
			link: (d) => ({ href: d, text: 'elsewhere', title: null })
		});
		const { read } = editorReading([['wiki', [odd]]]);
		expect(read('[[note]]').some((n) => n.syntaxClaim)).toBe(false);
	});

	it('a cut inside a claim follows its `split`', () => {
		const plainWidget = inline({
			name: 'chip',
			label: 'Chip',
			prefix: '{',
			match: /\{[^}]*\}/,
			read: () => 1,
			sample: '{x}',
			split: 'plain',
			widget: { delete: 'whole', arrows: 'over', click: 'none' },
			draw: () => ({})
		});
		const { read, grammar } = editorReading([['chips', [plainWidget, embed()]]]);
		expect(splitBehaviorOf(read('{ab}')[0], '{ab}', grammar)).toBe('plain');
		expect(splitBehaviorOf(read('![[a.png]]')[0], '![[a.png]]', grammar)).toBe('whole');
	});

	// Miss-analysis: the split rows asked a claim's own node, never a byte in a link's text, whose
	// node carries the claim too: the cut moved to the text's edge, and a paste there tore the claim.
	it('a cut inside an own-syntax link’s text moves to the claim’s edge, not the text’s', () => {
		const raw = 'See [[note|Shown]] here\n';
		const { grammar } = editorReading([['wiki', [wikiLink()]]]);
		const reading = { grammar, resolver: undefined } as never;
		const node = parse(raw, { scope: 'fragment', grammar }).children[0];
		// The side is the half of the text the caret is in, the hidden target's bytes aside.
		expect(cutOutsideWhole(node, 15, reading)).toBe(18);
		expect(cutOutsideWhole(node, 12, reading)).toBe(4);
		expect(cutOutsideWhole(node, 6, reading)).toBe(4);
		expect(cutOutsideWhole(node, 2, reading)).toBe(2);
	});

	it('a construct inside a claim that says no `split` still answers by its own row', () => {
		registerInlineSyntax(
			'[',
			(raw, pos): InlineNode | null =>
				raw.startsWith('[[\\*x]]', pos)
					? {
							kind: 'link',
							start: pos,
							end: pos + 7,
							url: 'u',
							children: [
								{ kind: 'escape', start: pos + 2, end: pos + 4 },
								{ kind: 'text', start: pos + 4, end: pos + 5, text: 'x' }
							]
						}
					: null,
			{ prefix: '[[', priority: INLINE_PRIORITIES.prefixOverride }
		);
		const raw = 'a [[\\*x]] z\n';
		const { grammar } = editorReading([]);
		const node = parse(raw, { scope: 'fragment', grammar }).children[0];
		expect(cutOutsideWhole(node, 5, { grammar, resolver: undefined } as never)).toBe(4);
	});

	// Miss-analysis: the row checked the decline and never asked whether the author heard of it,
	// and a link that silently reads as text is a bug report nobody can place.
	it('a link whose text its claim spells twice is left to the editor until `at` says which', () => {
		const { read } = editorReading([['wiki', [wikiLink()]]]);
		expect(read('[[notebook|note]]').some((n) => n.syntaxClaim)).toBe(false);
		expect(read('[[notebook|note]] [[scratchpad|pad]]').some((n) => n.syntaxClaim)).toBe(false);
		expect(read('[[page|note]]')[0]).toMatchObject({ kind: 'link', url: 'page' });
		const warned = takeDevWarnsOf('inline-link-text');
		expect(warned.map((w) => w.message)).toEqual([
			'inline \'wiki/link\': the link text "note" shows up twice in "[[notebook|note]]", so the claim reads as text; give its LinkPiece an `at`'
		]);
	});
});

describe("inline(): what a widget's arrows and click do", () => {
	type Cell = [arrows: 'over' | 'select' | 'into', click: 'source' | 'follow' | 'none'];
	const cells: Cell[] = [];
	for (const arrows of ['over', 'select', 'into'] as const)
		for (const click of ['source', 'follow', 'none'] as const) cells.push([arrows, click]);
	// What each cell answers: an arrow shows the bytes, a click shows them, the edge policy, a follow.
	const expected: Record<string, [boolean, boolean, string | undefined, boolean]> = {
		'over source': [false, true, 'step-over', false],
		'over follow': [false, false, 'step-over', true],
		'over none': [false, false, 'step-over', false],
		'select source': [false, true, 'select', false],
		'select follow': [false, false, 'select', true],
		'select none': [false, false, 'select', false],
		'into source': [true, true, undefined, false],
		'into follow': [true, true, undefined, true],
		'into none': [true, false, undefined, false]
	};
	it.each(cells)('arrows %s, click %s', (arrows, click) => {
		const chip = inline({
			name: 'chip',
			label: 'Chip',
			prefix: '{',
			match: /{[^}]*}/,
			read: () => 1,
			sample: '{x}',
			widget: { delete: 'whole', arrows, click },
			draw: () => ({}),
			...(click === 'follow' && { follow: () => {} })
		} as never);
		const { grammar } = editorReading([['chips', [chip]]]);
		const editing = grammar.inlines!().get('chips/chip' as never)!.widget!.editing as WidgetEditing;
		const answer = [
			revealsOnArrow(editing),
			revealsOnClick(editing),
			editing.onEdge,
			editing.claimsActivationClick === true
		];
		expect(answer).toEqual(expected[`${arrows} ${click}`]);
	});
});

// Miss-analysis: no row asked what `caret` is handed, so the claim's bytes went missing unseen.
it("inline(): a widget's caret gets the click's point and the claim's bytes", () => {
	const caret = vi.fn(
		(_el: HTMLElement, _point: ViewportPoint, source: string) => source.length - 1
	);
	const chip = inline({
		name: 'chip',
		label: 'Chip',
		prefix: '{',
		match: /{[^}]*}/,
		read: () => 1,
		sample: '{x}',
		widget: { delete: 'whole', arrows: 'into', click: 'source', caret },
		draw: () => ({})
	});
	const { grammar } = editorReading([['chips', [chip]]]);
	const editing = grammar.inlines!().get('chips/chip' as never)!.widget!.editing as WidgetEditing;
	const el = document.createElement('span');
	const point: ViewportPoint = { x: 3, y: 4, offsetIn: () => 1 };
	expect(editing.revealOffsetAtPoint!(el, '{xyz}', 3, 4, point)).toBe(4);
	expect(caret).toHaveBeenCalledWith(el, point, '{xyz}');
});

describe('inline(): installing and making', () => {
	it('reports a construct another plugin made, a second of one name and a stray value', () => {
		const note = wikiWidget();
		const twin = inline({ ...wikiWidgetSpec(), match: /\[\[x\]\]/ });
		const { reports, read } = editorReading([
			['wiki', [note, twin]],
			['other', [note, { name: 'stray', label: 'Stray' } as never]]
		]);
		expect(reports.map((r) => `${r.plugin}: ${(r.cause as Error).message}`)).toEqual([
			"wiki: plugin 'wiki' has two inlines named 'note'; the second is left out",
			"other: plugin 'other' lists the inline 'wiki/note', which plugin 'wiki' made; it's left out",
			"other: plugin 'other' lists 'stray', which `inline` didn't make; it's left out"
		]);
		expect(read('[[note]]')[0].kind).toBe('wiki/note');
	});

	it.each([
		['a bad name', { name: 'Bad' }, 'invalid name'],
		['an unreachable prefix', { prefix: ']]' }, 'can never be reached'],
		['a bare built-in character', { prefix: '*' }, 'needs a second character'],
		['`pair` on a long prefix', { pair: true }, 'one-character prefix'],
		[
			'follow without its click',
			{ widget: { delete: 'whole', arrows: 'into', click: 'none' } },
			'go together'
		]
	])('refuses %s when it is made', (_name, override, message) => {
		expect(() => inline({ ...wikiWidgetSpec(), ...override } as never)).toThrow(message);
	});

	it('takes a spec an author typed as `InlineSpec`', () => {
		const spec: InlineSpec<string> = {
			name: 'typed',
			label: 'Typed',
			prefix: '%',
			match: /%\w+/,
			read: (m: RegExpExecArray) => m[0],
			sample: '%a',
			class: 'typed'
		};
		expect(inline(spec).name).toBe('typed');
	});

	it('the table keeps its identity while the list does', () => {
		const { grammar } = editorReading([['wiki', [wikiWidget()]]]);
		expect(inlineTable(grammar)).toBe(inlineTable(grammar));
	});

	// A sticky regex on an unclosed `[[` flood reads to the end at every prefix; a function that
	// stops at the next bracket or line keeps the editor's scan linear.
	it('a function matcher on an unclosed flood scans within a bounded growth ratio', () => {
		const flood = inline({
			name: 'note',
			label: 'Note',
			prefix: '[[',
			match: (text, at, end) => {
				for (let i = at + 2; i < end; i++) {
					if (text[i] === '[' || text[i] === '\n') return -1;
					if (text.startsWith(']]', i)) return i + 2;
				}
				return -1;
			},
			read: (claim) => claim,
			sample: '[[x]]',
			class: 'note'
		});
		const { read } = editorReading([['wiki', [flood]]]);
		expectBoundedGrowth(measureScanGrowth((raw) => void read(raw), '[[a ', [16, 64]));
	}, 300_000);
});

function wikiWidgetSpec() {
	return {
		name: 'note',
		label: 'Note',
		prefix: '[[',
		match: /\[\[([^\]\n]+)\]\]/,
		read: (m: RegExpExecArray) => ({ target: m[1] }),
		sample: '[[note]]',
		widget: { delete: 'whole' as const, arrows: 'into' as const, click: 'follow' as const },
		draw: () => ({}),
		follow: () => {}
	};
}
