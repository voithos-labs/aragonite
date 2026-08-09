// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { rebalanceLiveSplit } from '$lib/components/blocks/text/live-split-rebalance';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';

// The bytes a live-mode Enter writes into each half. Every case states the plain byte-literal cut
// the rewrite is offered — that is what a decline leaves behind — so a null return is as pinned as
// a rewrite. `\n` padding is what `splitNode` has already added when the hook runs.

function split(source: string, offset: number) {
	const node = parse(source, { scope: 'fragment' }).children[0];
	const raw = node.raw;
	const first = raw.slice(0, offset);
	const second = raw.slice(offset);
	return rebalanceLiveSplit(
		node,
		offset,
		first.endsWith('\n') ? first : first + '\n',
		second.endsWith('\n') ? second : second + '\n',
		undefined
	);
}

describe('a cut inside a symmetric pair closes it and reopens it', () => {
	it('bold splits into two bold constructs', () => {
		expect(split('**bold**\n', 4)).toEqual({ firstRaw: '**bo**\n', secondRaw: '**ld**\n' });
	});

	it('the surrounding text stays where it was', () => {
		expect(split('Some **bold** text\n', 9)).toEqual({
			firstRaw: 'Some **bo**\n',
			secondRaw: '**ld** text\n'
		});
	});

	it('emphasis, strikethrough and a code span each reopen with their own run', () => {
		expect(split('*ital*\n', 3)).toEqual({ firstRaw: '*it*\n', secondRaw: '*al*\n' });
		expect(split('~~del~~\n', 4)).toEqual({ firstRaw: '~~de~~\n', secondRaw: '~~l~~\n' });
		expect(split('`code`\n', 3)).toEqual({ firstRaw: '`co`\n', secondRaw: '`de`\n' });
	});

	// The fence is the span's own, not one backtick: a doubled fence exists because the content
	// holds a backtick, and reopening with a single one would swallow the rest of the line.
	it('a code span reopens with its real fence', () => {
		expect(split('`` a`b c ``\n', 6)).toEqual({
			firstRaw: '`` a`b``\n',
			secondRaw: '`` c ``\n'
		});
	});

	// A fence the reopened half would sit against is not the same fence any more, so the rewrite
	// declines rather than write a run that swallows the line.
	it('declines when the reopened fence would abut a backtick', () => {
		expect(split('`` a`b ``\n', 4)).toBeNull();
	});

	// A cut on the soft break inside a construct: the split consumes the line ending, and both
	// halves still close. `splitNode` moved the cut past the ending before offering the halves.
	it('closes across a soft break the cut consumes', () => {
		const node = parse('**bo\nld**\n', { scope: 'fragment' }).children[0];
		expect(rebalanceLiveSplit(node, 4, '**bo\n', 'ld**\n', undefined)).toEqual({
			firstRaw: '**bo**\n',
			secondRaw: '**ld**\n'
		});
	});
});

describe('a split link duplicates its destination', () => {
	it('both halves link to the same url', () => {
		expect(split('[text](url)\n', 3)).toEqual({
			firstRaw: '[te](url)\n',
			secondRaw: '[xt](url)\n'
		});
	});

	// A reference form resolves through the document's definitions, which the split seam has no
	// access to, so the bytes read as plain text here and the cut stays literal.
	it('a reference form is left to the byte-literal cut', () => {
		expect(split('[text][ref]\n', 3)).toBeNull();
	});
});

describe('nested constructs rebalance outermost first', () => {
	// `**a *ital* b**`: strong [0,14) content [2,12), emphasis [4,10) content [5,9).
	it('the italic closes inside the bold on the left and reopens inside it on the right', () => {
		expect(split('**a *ital* b**\n', 7)).toEqual({
			firstRaw: '**a *it***\n',
			secondRaw: '***al* b**\n'
		});
	});

	it('a bold inside a link carries both the url and the pair', () => {
		expect(split('[a **bc** d](u)\n', 6)).toEqual({
			firstRaw: '[a **b**](u)\n',
			secondRaw: '[**c** d](u)\n'
		});
	});
});

describe('a cut at a construct edge hands the construct over whole', () => {
	// `Some **bold** text`: the caret at 7 and at 5 are the same pixel, so the pair must not be
	// minted empty — `Some ****` is invisible residue live mode may never write.
	it('at content start the construct goes to the second half', () => {
		expect(split('Some **bold** text\n', 7)).toEqual({
			firstRaw: 'Some \n',
			secondRaw: '**bold** text\n'
		});
	});

	it('at content end the construct goes to the first half', () => {
		expect(split('Some **bold** text\n', 11)).toEqual({
			firstRaw: 'Some **bold**\n',
			secondRaw: ' text\n'
		});
	});

	// The space the handover strands cannot open a run, so it moves outside the delimiters —
	// invisible either way, and the alternative is a literal `*` on screen.
	it('a boundary space moves outside the run rather than kill it', () => {
		expect(split('**a *ital* b**\n', 5)).toEqual({
			firstRaw: '**a** \n',
			secondRaw: '***ital* b**\n'
		});
		expect(split('**a *ital* b**\n', 9)).toEqual({
			firstRaw: '**a *ital***\n',
			secondRaw: ' **b**\n'
		});
	});
});

describe('constructs that declare no rewrite decline the whole cut', () => {
	it('an image splits byte-literally', () => {
		expect(split('![alpha](u)\n', 4)).toBeNull();
	});

	it('an escape and a hard break are atomic', () => {
		expect(split('a\\*b\n', 2)).toBeNull();
		expect(split('x  \ny\n', 2)).toBeNull();
	});

	it('an autolink has no policy row at all', () => {
		expect(split('<https://example.com>\n', 8)).toBeNull();
	});

	it('a cut outside every construct is left alone', () => {
		expect(split('Some **bold** text\n', 3)).toBeNull();
		expect(split('Some **bold** text\n', 5)).toBeNull();
		expect(split('Some **bold** text\n', 13)).toBeNull();
	});

	it('a non-prose block is never rebalanced', () => {
		const fence = parse('```\n**a**\n```\n', { scope: 'fragment' }).children[0];
		expect(rebalanceLiveSplit(fence, 6, '```\n**a\n', '**\n```\n', undefined)).toBeNull();
	});
});

describe('the seam is resolved against the flanking rules, not around them', () => {
	// `** c**` is not left-flanking, so the naive reopen would print literal stars; the space
	// steps outside instead and the bold reaches the word it belongs to.
	it('a nested construct at its own trailing edge still reopens outside', () => {
		expect(split('**a *b* c**\n', 6)).toEqual({
			firstRaw: '**a *b***\n',
			secondRaw: ' **c**\n'
		});
	});

	it('a cut at content end hands the construct over rather than reopening it empty', () => {
		expect(split('_a_\n', 2)).toEqual({ firstRaw: '_a_\n', secondRaw: '\n' });
	});
});

describe('the first half never parses to more than one block', () => {
	// The multi-block first half is `splitNode`'s dev-warn-only case; the rewrite makes it
	// unreachable by refusing any candidate whose halves are not one prose block each.
	const adversarial: [string, number][] = [
		['# **head**\n', 5],
		['**bold**\n===\n', 4],
		['> **q**\n', 4],
		['**a**\n---\n', 3],
		['- **li**\n', 5],
		['**a `b` c**\n', 6],
		['**[a](u)**\n', 4],
		['   **ind**\n', 6],
		['**a**\n***\n', 3]
	];

	for (const [source, offset] of adversarial) {
		it(`${JSON.stringify(source)}@${offset} yields one block per half or nothing`, () => {
			const result = split(source, offset);
			if (result === null) return;
			for (const raw of [result.firstRaw, result.secondRaw]) {
				expect(parse(raw, { scope: 'fragment' }).children).toHaveLength(1);
			}
		});
	}

	it('rewrites most of the adversarial set, so the rule above is not vacuous', () => {
		const rewritten = adversarial.filter(([source, offset]) => split(source, offset) !== null);
		expect(rewritten.length).toBeGreaterThanOrEqual(6);
	});
});

// The resolver rides the CALL, never the registration: it is per-instance while the slot is
// process-global. Without it a reference form reads as brackets and the cut declines, which is
// sound and still a marker leak — the whole reason the axis exists.
describe('a reference form rebalances only when the resolver reaches the seam', () => {
	const DOC = 'Visit [example][site] here\n\n[site]: https://example.com\n';

	function splitWithResolver(offset: number, withResolver: boolean) {
		const doc = parse(DOC);
		const node = doc.children[0];
		const raw = node.raw;
		const map = buildLinkReferenceMap(doc.children);
		return rebalanceLiveSplit(
			node,
			offset,
			raw.slice(0, offset) + '\n',
			raw.slice(offset),
			withResolver ? { current: map.resolve, signature: map.signature } : undefined
		);
	}

	it('the halves each carry the reference', () => {
		expect(splitWithResolver(10, true)).toEqual({
			firstRaw: 'Visit [exa][site]\n',
			secondRaw: '[mple][site] here\n'
		});
	});

	it('declines with no resolver, because the brackets read as text', () => {
		expect(splitWithResolver(10, false)).toBeNull();
	});
});
