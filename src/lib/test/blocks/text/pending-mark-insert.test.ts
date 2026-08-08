// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { renderedText } from '$lib/core/inline-render';
import { resolveMarkedInsertion } from '$lib/components/blocks/text/pending-mark-insert';
import type { InlineMarkKind } from '$lib/cursor/pending-marks';
import type { InlineNode } from '$lib/core/nodes';

// The bytes a pending toggle turns the next keystroke into. Live paints no delimiter, so the
// source IS the oracle, and every case re-parses the result.
// Miss-analysis, twice: the first cut used single-WORD fixtures, so `**hello world**` split at
// the space shipped literal stars; the second checked visibility with a private walk that called
// an autolink's `<`/`>` content, so a splice that destroyed the link read as clean.

function insert(
	display: string,
	caret: number,
	text: string,
	marks: InlineMarkKind[]
): { raw: string; caret: number } | null {
	return resolveMarkedInsertion(
		display,
		caret,
		text,
		new Set(marks),
		parseInline(display, 0, display.length)
	);
}

/** The construct kinds the parser puts around `probe` in the rewritten bytes. */
function kindsAround(raw: string, probe: string): string[] {
	const at = raw.indexOf(probe);
	const found: string[] = [];
	const visit = (nodes: InlineNode[]): void => {
		for (const node of nodes) {
			if (node.start <= at && at + probe.length <= node.end) {
				if (node.kind !== 'text') found.push(node.kind);
				if (node.children) visit(node.children);
			}
		}
	};
	visit(parseInline(raw, 0, raw.length));
	return found;
}

/** What a reader sees, asked of the renderer. The hand-written walk that stood here counted an
 *  angle autolink's `<`/`>` as content, so it could not see them surface. */
function visibleText(raw: string): string {
	return renderedText(parseInline(raw, 0, raw.length), raw);
}

describe('applying a mark the chain does not carry', () => {
	it('wraps the insertion and lands the caret inside the pair', () => {
		expect(insert('ab', 2, 'X', ['strong'])).toEqual({ raw: 'ab**X**', caret: 5 });
		expect(kindsAround('ab**X**', 'X')).toEqual(['strong']);
	});

	it('two marks nest into one run, whatever order the chords arrived in', () => {
		const both = insert('', 0, 'X', ['strong', 'emphasis']);
		expect(both).toEqual({ raw: '***X***', caret: 4 });
		expect(kindsAround('***X***', 'X')).toEqual(['emphasis', 'strong']);
	});

	it('wraps inside a construct it does not mark, so a link keeps its text', () => {
		expect(insert('[ab](u)', 3, 'X', ['strong'])).toEqual({ raw: '[ab**X**](u)', caret: 6 });
		expect(kindsAround('[ab**X**](u)', 'X')).toEqual(['link', 'strong']);
	});

	// A caret already inside emphasis, toggling strong on: emphasis is untouched, strong is new.
	it('adds a mark alongside one the chain already carries', () => {
		expect(insert('*ab*', 3, 'X', ['strong'])).toEqual({ raw: '*ab**X***', caret: 6 });
		expect(kindsAround('*ab**X***', 'X')).toEqual(['emphasis', 'strong']);
	});

	it('declines when the marks name nothing to do', () => {
		expect(insert('ab', 1, 'X', [])).toBeNull();
		expect(insert('ab', 1, '', ['strong'])).toBeNull();
	});
});

describe('removing a mark the chain carries', () => {
	// Strictly inside: the construct closes before the byte and reopens after it, so the
	// insertion is the only unmarked text in the run.
	it('splits the construct close-and-reopen at an interior caret', () => {
		expect(insert('**ab**', 3, 'X', ['strong'])).toEqual({ raw: '**a**X**b**', caret: 6 });
		expect(kindsAround('**a**X**b**', 'X')).toEqual([]);
		expect(kindsAround('**a**X**b**', 'a')).toEqual(['strong']);
		expect(kindsAround('**a**X**b**', 'b')).toEqual(['strong']);
	});

	// At a content edge the split's near half would be empty, and an empty pair is exactly
	// the invisible `****` residue live mode must never mint: step outside the run instead.
	it('steps past the closer at the trailing content edge', () => {
		expect(insert('**ab**', 4, 'X', ['strong'])).toEqual({ raw: '**ab**X', caret: 7 });
		expect(kindsAround('**ab**X', 'X')).toEqual([]);
	});

	it('steps before the opener at the leading content edge', () => {
		expect(insert('**ab**', 2, 'X', ['strong'])).toEqual({ raw: 'X**ab**', caret: 1 });
		expect(kindsAround('X**ab**', 'X')).toEqual([]);
	});

	it('leaves surrounding text outside the construct untouched', () => {
		expect(insert('hi **ab** yo', 6, 'X', ['strong'])).toEqual({
			raw: 'hi **a**X**b** yo',
			caret: 9
		});
	});

	// Nested `***ab***` is emphasis around strong. Escaping the OUTER construct escapes the
	// inner one with it — bytes cannot leave a parent while staying in its child — so the
	// kind the user kept is re-declared around the payload instead.
	it('escapes the inner construct with the outer one and re-declares what was kept', () => {
		const result = insert('***ab***', 4, 'X', ['emphasis']);
		expect(result?.raw).toBe('***a*****X*****b***');
		expect(kindsAround(result!.raw, 'X')).toEqual(['strong']);
		expect(kindsAround(result!.raw, 'a')).toEqual(['emphasis', 'strong']);
	});

	it('removing both kinds at once leaves the insertion plain', () => {
		const result = insert('***ab***', 4, 'X', ['emphasis', 'strong']);
		expect(result?.raw).toBe('***a***X***b***');
		expect(kindsAround(result!.raw, 'X')).toEqual([]);
	});

	// The escape reaches only as far out as the removed kind: at the inner pair's leading
	// content edge the byte steps outside STRONG and stays inside the emphasis around it.
	it('escapes only the removed construct, not the one wrapping it', () => {
		expect(insert('***ab***', 3, 'X', ['strong'])).toEqual({ raw: '*X**ab***', caret: 2 });
		expect(kindsAround('*X**ab***', 'X')).toEqual(['emphasis']);
	});

	// A removal and an application at once: the byte leaves bold and arrives italic.
	it('removes one kind and applies another in the same insertion', () => {
		const result = insert('**ab**', 4, 'X', ['strong', 'emphasis']);
		expect(result).toEqual({ raw: '**ab***X*', caret: 8 });
		expect(kindsAround('**ab***X*', 'X')).toEqual(['emphasis']);
	});
});

// Every row here was measured wrong before the resolver verified its own output. The split that
// reads right — close the pair, insert, reopen — is only legal where CommonMark's flanking rules
// and rule-of-three read it back that way, and whitespace or a nested pair at the seam is enough
// to break it. The check is the same three questions each time: the bytes, the construct chain
// the parser puts around the insertion, and whether a delimiter turned into a visible star.
describe('a candidate that would not parse back is not written', () => {
	const spaceCases: [string, number, string][] = [
		['before the space', 7, 'X**hello world**'],
		['after the space', 8, '**hello world**X']
	];
	for (const [where, caret, expected] of spaceCases) {
		it(`un-bolding ${where} of "hello world" steps outside instead of splitting`, () => {
			const result = insert('**hello world**', caret, 'X', ['strong']);
			// The split candidate would have been `**hello**X** world**`, whose closing run is not
			// left-flanking before a space: it renders `helloX** world**`, stars and all.
			expect(result?.raw).toBe(expected);
			expect(kindsAround(result!.raw, 'X')).toEqual([]);
			expect(visibleText(result!.raw)).toBe(caret === 7 ? 'Xhello world' : 'hello worldX');
		});
	}

	it('un-bolding between nested emphasis leaves the byte emphasized, never more formatted', () => {
		const result = insert('**a*b*c**', 5, 'X', ['strong']);
		expect(result?.raw).toBe('**a*b*c***X*');
		expect(kindsAround(result!.raw, 'X')).toEqual(['emphasis']);
		expect(visibleText(result!.raw)).toBe('abcX');
	});

	it('un-emphasizing around a nested strong leaves the byte strong only', () => {
		const result = insert('*a **b** c*', 6, 'X', ['emphasis']);
		expect(result?.raw).toBe('*a **b** c***X**');
		expect(kindsAround(result!.raw, 'X')).toEqual(['strong']);
		expect(visibleText(result!.raw)).toBe('a b cX');
	});

	// The escape would have to cut the link open, and a link's delimiters are not a symmetric
	// pair: splicing `**` inside its text writes bytes the reader sees.
	it('declines rather than splice a delimiter inside link text', () => {
		expect(insert('**[ab](u)**', 4, 'X', ['strong'])).toBeNull();
	});

	// Same rule for a construct whose content is verbatim: a mark applied inside a code span can
	// only ever be literal.
	it('declines rather than splice a delimiter inside a code span', () => {
		expect(insert('a `code` b', 6, 'X', ['strong'])).toBeNull();
		expect(insert('**a `c` b**', 6, 'X', ['strong'])).toBeNull();
	});

	// Markdown cannot write two same-kind runs side by side: `*a*` + `*X*` is `*a**X*`, whose
	// middle run parses as literal text. Declining types the byte plain — the only outcome that
	// keeps § 1's "markers are never visible".
	it('declines a wrap whose delimiters would merge with the run beside it', () => {
		expect(insert('*a*', 3, 'X', ['emphasis'])).toBeNull();
		expect(insert('**a**', 5, 'X', ['strong'])).toBeNull();
	});

	it('still wraps beside a run of the other kind, which cannot merge', () => {
		const result = insert('**a**', 5, 'X', ['emphasis']);
		expect(result?.raw).toBe('**a***X*');
		expect(kindsAround(result!.raw, 'X')).toEqual(['emphasis']);
		expect(visibleText(result!.raw)).toBe('aX');
	});

	// Non-ASCII content must not change the answer: the seam is delimiter arithmetic, not bytes.
	it('answers the same for non-ASCII content', () => {
		const result = insert('**héllo wörld**', 8, 'X', ['strong']);
		expect(result?.raw).toBe('**héllo wörld**X');
		expect(visibleText(result!.raw)).toBe('héllo wörldX');
	});
});

// A construct with no CHILDREN has no content range, so the chain walk used to skip it and never
// descend — it was absent from `intended`, and the invisibility check could not see its markers
// either, because the private walk it used called them content. An autolink is the reachable
// case: the URL is one childless span whose angle brackets are marker spans.
describe('a childless construct is in the chain, so nothing may cut it open', () => {
	const ANGLE = 'see <https://example.com> now';

	it('declines a mark applied inside an angle autolink’s URL', () => {
		// The wrap would have been `see <https**X**://example.com> now`, which kills the autolink
		// and paints its `<` and `>`.
		expect(insert(ANGLE, 10, 'X', ['strong'])).toBeNull();
	});

	it('still marks normally on either side of it', () => {
		const before = insert(ANGLE, 4, 'X', ['strong']);
		expect(before?.raw).toBe('see **X**<https://example.com> now');
		expect(kindsAround(before!.raw, 'X')).toEqual(['strong']);
		expect(visibleText(before!.raw)).toBe('see Xhttps://example.com now');

		const after = insert(ANGLE, 25, 'X', ['strong']);
		expect(after?.raw).toBe('see <https://example.com>**X** now');
		expect(visibleText(after!.raw)).toBe('see https://example.comX now');
	});

	// A BARE autolink paints no marker at all, so a wrap inside it is visible only as the link
	// dying — which is exactly what the render-path oracle sees and a byte census would not.
	it('declines a mark applied inside a bare autolink', () => {
		expect(insert('see https://example.com now', 10, 'X', ['strong'])).toBeNull();
	});

	it('declines inside an escape and inside a hard break’s run', () => {
		expect(insert('x \\* y', 3, 'X', ['strong'])).toBeNull();
		expect(insert('end  \nnext', 4, 'X', ['strong'])).toBeNull();
	});
});
