import { describe, it, expect } from 'vitest';
import { parseInline } from '$lib/core/inline';
import { resolveMarkedInsertion } from '$lib/components/blocks/text/pending-mark-insert';
import type { InlineMarkKind } from '$lib/cursor/pending-marks';
import type { InlineNode } from '$lib/core/nodes';

// The bytes a pending toggle turns the next keystroke into. Live mode paints no delimiter, so
// the source IS the oracle; every case additionally re-parses the result, because a rewrite
// that reads right and parses wrong is the failure mode delimiter-run arithmetic actually has.

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
