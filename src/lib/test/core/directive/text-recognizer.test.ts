// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { parseInline } from '$lib/core/inline';
import type { InlineNode } from '$lib/core/nodes';
import { recognizeTextDirective } from '$lib/core/directive/text-recognizer';
import { buildCoreInlineWidget, getInlineWidgetEditing } from '$lib/core/inline/inline-widgets';
import { declaredPluginInlineKind } from '$lib/schema/plugin-kind';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import { DIRECTIVE_TEXT } from '$lib/core/directive/kinds';

activateDirectiveGrammar(); // declares directiveText + widget + ':' recognizer, before any parse

const kind = declaredPluginInlineKind(DIRECTIVE_TEXT);
const recognize = (raw: string, pos: number, end: number) =>
	recognizeTextDirective(raw, pos, end, kind);

// The decline/consume table is the point of the text tier: the recognizer OWNS
// `:name[label]{attrs}` atomically (so the scanner's bracket stack never sees the
// inner `[label]`) and stays conservative everywhere else. `null` = leave `:`
// literal; a number = `end` past the whole consumed span.
describe('recognizeTextDirective', () => {
	const cases: Array<[raw: string, pos: number, end: number, expectedEnd: number | null]> = [
		[':x[a]{k=v} rest', 0, 15, 10], // consumes :x[a]{k=v} atomically
		[':x[a](b)', 0, 8, 5], // :x[a]; '(b)' left literal
		[':x[a[b]c]', 0, 9, 9], // balanced nested brackets are one label
		[':x{k=v}', 0, 7, 7], // label-less
		[':smile:', 0, 7, null], // name not followed by [ or {
		['10:30', 2, 5, null], // name must start with a letter
		['http://x', 4, 8, null], // :// scheme separator
		[':x[a', 0, 4, null], // unbalanced — runs off end
		[':x{', 0, 3, null], // unbalanced label-less braces decline
		[':x[a]{', 0, 6, null] // valid label + unbalanced trailing brace declines the whole span
	];

	for (const [raw, pos, end, expectedEnd] of cases) {
		const label = expectedEnd === null ? 'null' : `end ${expectedEnd}`;
		it(`${JSON.stringify(raw)} @${pos} → ${label}`, () => {
			const node = recognize(raw, pos, end);
			if (expectedEnd === null) {
				expect(node).toBeNull();
			} else {
				expect(node).toEqual({ kind, start: pos, end: expectedEnd });
			}
		});
	}
});

describe('text directive through the parse pipeline', () => {
	const src = 'see :abbr[HTML]{title="x"} here';

	it('round-trips a paragraph containing a text directive byte-for-byte', () => {
		expect(serialize(parse(src))).toBe(src);
	});

	it('parses the span to a directiveText node spanning the full :name[...]{...}', () => {
		const directive = parseInline(src, 0, src.length).find((n) => n.kind === DIRECTIVE_TEXT);
		expect(directive).toMatchObject({ start: 4, end: 26 });
	});

	it('does not recognize a directive inside a code span', () => {
		const nodes = parseInline('`:x[a]`', 0, 7);
		expect(nodes.some((n) => n.kind === DIRECTIVE_TEXT)).toBe(false);
		expect(nodes.some((n) => n.kind === 'inlineCode')).toBe(true);
	});
});

describe('directiveText atomic widget', () => {
	it('renders a source-bearing atomic shell mirroring the inline-widget contract', () => {
		const raw = 'see :abbr[HTML]{title="x"} here';
		const node = { kind, start: 4, end: 26 } as InlineNode;

		const el = buildCoreInlineWidget(node, raw);

		expect(el).not.toBeNull();
		const shell = el as HTMLElement;
		expect(shell.hasAttribute('data-inline-widget')).toBe(true);
		expect(shell.getAttribute('contenteditable')).toBe('false');
		expect(shell.dataset.sourceStart).toBe('4');
		expect(shell.dataset.sourceEnd).toBe('26');
		expect(shell.textContent).toBe(':abbr[HTML]{title="x"}');
	});

	// reveal-source is the contract the widget-interaction layer reads to swap the
	// rendered island for its editable source on focus; pin its exact shape so the
	// text tier stays editable, not a read-only atom.
	it('registers the reveal-source editing policy', () => {
		expect(getInlineWidgetEditing(kind)).toEqual({ revealSource: true });
	});
});
