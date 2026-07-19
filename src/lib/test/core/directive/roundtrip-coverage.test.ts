// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { getPluginMetadata, type CstNode } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { parseInline } from '$lib/core/inline';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import {
	rebuildDirectiveContainerRaw,
	DIRECTIVE_CONTAINER,
	DIRECTIVE_TEXT,
	type DirectiveContainerMetadata
} from '$lib/core/directive/kinds';
import {
	registerDirective,
	__resetDirectiveRegistryForTests,
	type ParsedDirective
} from '$lib/core/directive/registry';
import { arbGfmDoc, freshOrFixedSeed } from '../../invariants/arbitraries';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';

activateDirectiveGrammar(); // :::/:: openers + the ':' recognizer, before any parse

// The acceptance gate for the directive primitive: a fast-check arbitrary that
// spans the whole construct space (all three tiers, colon counts, nesting,
// non-ASCII info/label, registered + unregistered names, trailing-newline
// variants) and asserts the master invariant serialize(parse(src)) === src.
// Curated non-ASCII pools (not fc.unicode) keep the boundary shapes — CJK, astral
// emoji, combining marks — reliably reachable, mirroring the invariants inline
// arbitrary. Reachability of the bug-carrying shapes is proven below, per the
// culture rule that an arbitrary which can't produce the class proves nothing.

const isNonAscii = (s: string): boolean => [...s].some((ch) => (ch.codePointAt(0) ?? 0) > 0x7f);

// ── Names ───────────────────────────────────────────────────────────────────

const NAME_START = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const NAME_CHAR = [...NAME_START, ...'0123456789-'.split('')];

const arbGenericName = fc
	.tuple(fc.constantFrom(...NAME_START), fc.array(fc.constantFrom(...NAME_CHAR), { maxLength: 6 }))
	.map(([head, tail]) => head + tail.join(''));

// `note`/`warning` are registered on the container arm (below); every other name
// falls to the generic lossless kind. A generic draw may also land on those two —
// both the registry-dispatch and the fallback path must round-trip.
const arbName = fc.oneof(
	{ arbitrary: arbGenericName, weight: 4 },
	{ arbitrary: fc.constantFrom('note', 'warning'), weight: 1 },
	{ arbitrary: fc.constantFrom('a', 'x-y', 'note-2', 'H3', 'toc'), weight: 1 }
);

// ── Info / label / attrs (container + leaf opener remainder) ──────────────────

const NON_ASCII = ['日本語', '中文标题', 'café', 'Ünïçöde', '🎉', '😀🔥', 'é', '👩‍👦', '½', 'Ω', '—'];
const INNER_PUNCT = [
	'!',
	'?',
	':',
	';',
	'.',
	',',
	'(',
	')',
	'=',
	'|',
	'*',
	'"a b"',
	"'t'",
	'#x',
	'.cls'
];
const infoToken = fc.constantFrom(...NON_ASCII, ...INNER_PUNCT, 'word', 'x', '42', 'Title', '');
const arbInfoText = fc.array(infoToken, { maxLength: 4 }).map((tokens) => tokens.join(' '));

// The callout flavor needs a non-name-char boundary so the name/info split lands
// where intended (and a registered name still resolves); the attrs flavor opens
// with `[`/`{`, which already breaks the greedy name match.
const arbSeparator = fc.constantFrom(' ', '  ', '\t', ' \t ');
const arbCalloutInfo = fc.tuple(arbSeparator, arbInfoText).map(([sep, text]) => sep + text);
const arbAttrsInfo = fc
	.tuple(
		fc.option(
			arbInfoText.map((text) => `[${text}]`),
			{ nil: '' }
		),
		fc.option(
			fc
				.array(fc.constantFrom('.warn', '#main', 'k=v', 'title="a b"', 'lang=日本語', '.中文'), {
					minLength: 1,
					maxLength: 3
				})
				.map((tokens) => `{${tokens.join(' ')}}`),
			{ nil: '' }
		)
	)
	.map(([label, attrs]) => label + attrs);

const arbInfo = fc.oneof(
	{ arbitrary: fc.constant(''), weight: 2 },
	{ arbitrary: arbCalloutInfo, weight: 3 },
	{ arbitrary: arbAttrsInfo, weight: 2 }
);

// ── Text tier: inline `:name[label]{attrs}` ───────────────────────────────────

// Inner content is bracket-free so the recognizer's balanced scan resolves and
// the span is actually claimed (adjacency reachability depends on it).
const TEXT_INNER = ['HTML', 'x', '日本語', 'café', '🎉', 'a b', 'k-v', '中文', ''];
const arbTextLabel = fc.constantFrom(...TEXT_INNER).map((inner) => `[${inner}]`);
const arbTextAttrs = fc.constantFrom(
	'{k=v}',
	'{.warn}',
	'{#id}',
	'{title="a b"}',
	'{lang=日本語}',
	'{k=🎉}'
);
const arbTextDirective = fc
	.tuple(
		arbGenericName,
		fc.oneof(
			fc
				.tuple(arbTextLabel, fc.option(arbTextAttrs, { nil: '' }))
				.map(([label, attrs]) => label + attrs),
			arbTextAttrs
		)
	)
	.map(([name, rest]) => `:${name}${rest}`);

// A paragraph interleaving text directives with real links, images, emphasis and
// code — the adjacency the block/inline boundary must keep coexisting. The lead
// word keeps the line from starting with `::` (which would open a leaf instead).
const arbParaFragment = fc.oneof(
	{ arbitrary: fc.constantFrom('word', 'lorem', '42', '日本語', '🎉', 'café'), weight: 4 },
	{ arbitrary: arbTextDirective, weight: 4 },
	{
		arbitrary: fc.constantFrom(
			'[real](https://x.com)',
			'[a](u)',
			'![img](i.png)',
			'<https://y.io>'
		),
		weight: 2
	},
	{ arbitrary: fc.constantFrom('**b**', '_i_', '`c`', '~~s~~', '\\*'), weight: 2 }
);
const arbTextParagraph = fc
	.tuple(
		fc.constantFrom('a', 'x', 'see', 'text', 'z'),
		fc.array(arbParaFragment, { minLength: 1, maxLength: 6 })
	)
	.map(([lead, frags]) => `${lead} ${frags.join(' ')}\n`);

// ── Container tier (recursive, colon-count aware) ─────────────────────────────

const ensureTrailingNewline = (source: string): string =>
	source === '' ? '\n' : source.endsWith('\n') ? source : source + '\n';

const arbLeaf = fc.tuple(arbName, arbInfo).map(([name, info]) => `::${name}${info}\n`);

// A container body ends in a newline (or is empty) so the closer lands on its own
// line. Nesting draws an inner container strictly shorter than its parent: an
// inner colon run < parent never satisfies the parent's `isDirectiveCloser`
// (count >= parent), so the parent closes at its real closer, not the inner one.
function arbContainerBody(parentColon: number): fc.Arbitrary<string> {
	const arms: { arbitrary: fc.Arbitrary<string>; weight: number }[] = [
		{ arbitrary: fc.constant(''), weight: 1 },
		{ arbitrary: fc.constantFrom('\n', '\n\n'), weight: 1 },
		{
			arbitrary: fc
				.array(arbTextParagraph, { minLength: 1, maxLength: 2 })
				.map((ps) => ps.join('')),
			weight: 3
		},
		{ arbitrary: arbLeaf, weight: 1 },
		{ arbitrary: arbGfmDoc.map(ensureTrailingNewline), weight: 2 }
	];
	if (parentColon - 1 >= 3) {
		arms.push({ arbitrary: arbContainer(parentColon - 1), weight: 2 });
	}
	return fc.oneof(...arms);
}

// `cap` bounds this container's opener AND closer colon runs so a nested one stays
// strictly under its parent. Top level passes a cap above the 6-colon opener max,
// leaving room for a matched-or-longer closer (up to opener + 2).
function arbContainer(cap: number): fc.Arbitrary<string> {
	const maxColon = Math.min(6, cap);
	return fc.integer({ min: 3, max: Math.max(3, maxColon) }).chain((colon) => {
		const maxCloser = Math.max(colon, Math.min(colon + 2, cap));
		return fc
			.tuple(arbName, arbInfo, arbContainerBody(colon), fc.integer({ min: colon, max: maxCloser }))
			.map(([name, info, body, closerColon]) => {
				const opener = ':'.repeat(colon) + name + info + '\n';
				const closer = ':'.repeat(closerColon) + '\n';
				return opener + body + closer;
			});
	});
}

const TOP_CAP = 8;

const arbBlock = fc.oneof(
	{ arbitrary: arbContainer(TOP_CAP), weight: 4 },
	{ arbitrary: arbLeaf, weight: 2 },
	{ arbitrary: arbTextParagraph, weight: 3 },
	{ arbitrary: arbGfmDoc.map(ensureTrailingNewline), weight: 1 }
);

const arbMultiBlock = fc.array(arbBlock, { minLength: 1, maxLength: 5 }).map((bs) => bs.join(''));

// Trailing-newline variants: stripping the document-final newline drives a
// container's closerNewline=false and a bare final leaf/paragraph.
const arbDirectiveDoc = fc.oneof(
	{ arbitrary: arbMultiBlock, weight: 4 },
	{ arbitrary: arbBlock.map((b) => b.replace(/\n$/, '')), weight: 1 }
);

// ── CST walks (rebuild inverse + reachability) ────────────────────────────────

const NOTE = declarePluginKind('directiveNoteProbe');
const WARNING = declarePluginKind('directiveWarningProbe');

const isContainerNode = (node: CstNode): boolean =>
	node.kind === DIRECTIVE_CONTAINER || node.kind === NOTE || node.kind === WARNING;

function eachGenericContainer(nodes: CstNode[], visit: (node: CstNode) => void): void {
	for (const node of nodes) {
		if (node.kind === DIRECTIVE_CONTAINER) visit(node);
		if (node.children) eachGenericContainer(node.children, visit);
	}
}

function hasNesting(nodes: CstNode[], inside = false): boolean {
	for (const node of nodes) {
		const container = isContainerNode(node);
		if (container && inside) return true;
		if (node.children && hasNesting(node.children, inside || container)) return true;
	}
	return false;
}

function collectContainerInfos(nodes: CstNode[], out: string[]): void {
	for (const node of nodes) {
		if (node.kind === DIRECTIVE_CONTAINER) {
			const meta = getPluginMetadata<DirectiveContainerMetadata>(node);
			if (meta) out.push(meta.info);
		}
		if (node.children) collectContainerInfos(node.children, out);
	}
}

// ── Properties ────────────────────────────────────────────────────────────────

const PARAMS = { numRuns: 500, seed: freshOrFixedSeed(424242) } as const;
// SAMPLE_PARAMS feeds fc.sample for the reachability self-tests, which must stay
// deterministic (a fresh seed could miss a rare shape and flake), so it is left
// fixed rather than threaded through the fresh lane.
const SAMPLE_PARAMS = { numRuns: 3000, seed: 20260709 } as const;

describe('directive total-coverage round-trip', () => {
	let samples: string[] = [];

	beforeAll(() => {
		const wrapRaw = (kind: typeof NOTE) => ({
			kind,
			fromDirective: (parsed: ParsedDirective): CstNode => ({
				kind,
				leadingTrivia: parsed.leadingTrivia,
				raw: parsed.raw
			})
		});
		registerDirective('container', 'note', wrapRaw(NOTE));
		registerDirective('container', 'warning', wrapRaw(WARNING));
		samples = fc.sample(arbDirectiveDoc, SAMPLE_PARAMS);
	});
	afterAll(() => __resetDirectiveRegistryForTests());

	it('serialize(parse(s)) === s over generated directive constructs', () => {
		fc.assert(
			fc.property(arbDirectiveDoc, (src) => serialize(parse(src)) === src),
			PARAMS
		);
	});

	// The opaque contract makes serialize emit node.raw verbatim, so the round-trip
	// above passes even if the opener mis-captured metadata. Rebuilding raw from the
	// captured fields (the post-edit inverse) pins that the capture is faithful.
	it('generic container rebuild reproduces the opener bytes', () => {
		fc.assert(
			fc.property(arbDirectiveDoc, (src) => {
				eachGenericContainer(parse(src).children, (node) => {
					const before = node.raw;
					rebuildDirectiveContainerRaw(node);
					if (node.raw !== before) {
						throw new Error(
							`rebuild changed raw:\n${JSON.stringify(before)}\n→ ${JSON.stringify(node.raw)}`
						);
					}
				});
			}),
			PARAMS
		);
	});

	// Reachability evidence: the SAME arbitrary the properties run on must be able
	// to produce the bug-carrying shapes, or the coverage is illusory.
	it('CAN generate a container nested inside a container', () => {
		expect(samples.some((src) => hasNesting(parse(src).children))).toBe(true);
	});

	it('CAN generate a container whose info carries non-ASCII bytes', () => {
		const infos: string[] = [];
		for (const src of samples) collectContainerInfos(parse(src).children, infos);
		expect(infos.some(isNonAscii)).toBe(true);
	});

	it('CAN generate a text directive adjacent to a real link in one paragraph', () => {
		const found = samples.some((src) =>
			parse(src).children.some((block) => {
				if (block.kind !== 'paragraph') return false;
				const inline = parseInline(block.raw, 0, block.raw.replace(/\n$/, '').length);
				return (
					inline.some((n) => n.kind === DIRECTIVE_TEXT) && inline.some((n) => n.kind === 'link')
				);
			})
		);
		expect(found).toBe(true);
	});
});

// Hand-picked nasty shapes the generator under-weights, each pinned as a byte
// round-trip plus the structural fact the round-trip alone can't see (the
// serializer emits raw verbatim, so a wrong kind still round-trips). Names are
// unregistered here, so a container is always the generic kind.
describe('directive round-trip — adversarial interleaving + edge cases', () => {
	const containerBodies: Array<[label: string, src: string]> = [
		['list', ':::box\n- a\n- b\n:::\n'],
		['table', ':::box\n| h |\n| --- |\n| c |\n:::\n'],
		['fenced code', ':::box\n```\ncode\n```\n:::\n'],
		['blockquote', ':::box\n> quote\n:::\n'],
		['nested directive', '::::box\n:::inner\nx\n:::\n::::\n']
	];
	for (const [label, src] of containerBodies) {
		it(`round-trips a container whose body is a ${label}`, () => {
			expect(serialize(parse(src))).toBe(src);
			expect(parse(src).children[0].kind).toBe(DIRECTIVE_CONTAINER);
		});
	}

	it('keeps a text directive, a real link, and emphasis coexisting in one paragraph', () => {
		const src = 'a :x[y] [real](u) **b** :z{k=v} c';
		expect(serialize(parse(src))).toBe(src);
		const inline = parseInline(src, 0, src.length);
		expect(inline.filter((n) => n.kind === DIRECTIVE_TEXT).length).toBe(2);
		expect(inline.some((n) => n.kind === 'link')).toBe(true);
		expect(inline.some((n) => n.kind === 'strong')).toBe(true);
	});

	// Code resolves before the directive opener (fenced at priority 10, indented at
	// its indent rule), so a directive-shaped line — closer included — stays code.
	it('keeps a full ::: fence literal inside a fenced code block', () => {
		const src = '```\n:::note\nhi\n:::\n```\n';
		expect(serialize(parse(src))).toBe(src);
		expect(parse(src).children[0].kind).toBe('fencedCode');
	});

	it('keeps a ::: fence literal inside an indented code block', () => {
		const src = '    :::note\n    body\n    :::\n';
		expect(serialize(parse(src))).toBe(src);
		expect(parse(src).children[0].kind).toBe('indentedCode');
	});

	it('interrupts a paragraph with a leaf and resumes it after', () => {
		const src = 'before\n::toc\nafter\n';
		expect(serialize(parse(src))).toBe(src);
		expect(parse(src).children.map((c) => c.kind)).toEqual([
			'paragraph',
			'directiveLeaf',
			'paragraph'
		]);
	});

	it('places a leaf immediately after a container close', () => {
		const src = ':::box\nx\n:::\n::toc\n';
		expect(serialize(parse(src))).toBe(src);
		expect(parse(src).children.map((c) => c.kind)).toEqual(['directiveContainer', 'directiveLeaf']);
	});

	it('round-trips all three tiers mixed in one document', () => {
		const src = ':::box\ninner\n:::\n::toc\nsee :ab[c]{k=v} and [x](y)\n';
		expect(serialize(parse(src))).toBe(src);
	});
});
