// Miss-analysis: every case fed `cycleHeading` a hand-written raw whose marker a `^#` regex could
// reach, so no fixture ever drew the two shapes where the kind's own content range disagrees with
// that regex — a space-indented ATX heading and a setext one — and nothing asked what the arm does
// on the raw-editable kinds that bind the same keymap.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { getContentRange, isProseKind } from '$lib/core/inline';
import { cycleHeading } from '$lib/components/blocks/text/text-keydown';
import type { AnyBlockKind } from '$lib/core/nodes';

/** The pair the block command passes: a parsed block's raw and the range its kind declares. */
function block(source: string): {
	kind: AnyBlockKind;
	cycle: (level: number, offset: number) => ReturnType<typeof cycleHeading>;
} {
	const node = parse(source, { scope: 'document' }).children[0];
	const content = getContentRange(node);
	return {
		kind: node.kind,
		cycle: (level, offset) => cycleHeading(node.raw, content, level, offset)
	};
}

describe('cycleHeading — prose shapes', () => {
	it('marks a paragraph', () => {
		expect(block('Hello\n').cycle(1, 0)).toEqual({ newRaw: '# Hello\n', caretOffset: 2 });
	});

	it('replaces an existing level, and re-asking for the same one is a no-op edit', () => {
		expect(block('# Hello\n').cycle(2, 4)).toEqual({ newRaw: '## Hello\n', caretOffset: 5 });
		expect(block('# Hello\n').cycle(1, 4)).toEqual({ newRaw: '# Hello\n', caretOffset: 4 });
	});

	it('strips at level 0, and declines a paragraph that has nothing to strip', () => {
		expect(block('## Hello\n').cycle(0, 5)).toEqual({ newRaw: 'Hello\n', caretOffset: 2 });
		expect(block('Hello\n').cycle(0, 3)).toBeNull();
	});

	it('clamps a caret inside the old marker to the new content start', () => {
		expect(block('## Hello\n').cycle(1, 1)).toEqual({ newRaw: '# Hello\n', caretOffset: 2 });
	});

	it('preserves a CRLF ending and an absent one alike', () => {
		expect(block('Hello\r\n').cycle(3, 0)).toEqual({ newRaw: '### Hello\r\n', caretOffset: 4 });
		expect(block('Hello').cycle(1, 0)).toEqual({ newRaw: '# Hello', caretOffset: 2 });
	});

	it('marks an empty block', () => {
		expect(block('\n').cycle(2, 0)).toEqual({ newRaw: '## \n', caretOffset: 3 });
	});
});

describe('cycleHeading — shapes a marker regex cannot reach', () => {
	// Up to three leading spaces still open an ATX heading, and `^#{1,6}` never reaches that
	// marker: re-marking by regex left the old one standing as heading TEXT, compounding per press.
	it('gives up a space-indented ATX marker instead of writing a second one', () => {
		const indented = block('  ## x\n');
		expect(indented.kind).toBe('heading');
		expect(indented.cycle(3, 6)).toEqual({ newRaw: '### x\n', caretOffset: 5 });
	});

	// A setext heading keeps its structure AFTER the content, so re-marking by prefix left the
	// underline behind and the block split into an ATX heading plus a stray `===` paragraph.
	it('gives up a setext underline instead of leaving it below the new marker', () => {
		const setext = block('Title\n===\n');
		expect(setext.kind).toBe('setextHeading');
		expect(setext.cycle(2, 3)).toEqual({ newRaw: '## Title\n', caretOffset: 6 });
	});

	it('demotes a setext heading at level 0, where a prefix strip was a dead press', () => {
		expect(block('Title\n===\n').cycle(0, 3)).toEqual({ newRaw: 'Title\n', caretOffset: 3 });
	});
});

// The arm's `applies` gate in TextEditableBlock reads this predicate; these are the kinds that
// bind TEXT_EDITABLE_KEYMAP without being prose, where an ATX prefix is content, not structure.
describe('cycleHeading — the kinds the arm must decline', () => {
	it.each([
		['[a]: /url\n', 'linkReferenceDefinition'],
		['    code\n', 'indentedCode'],
		['<div>\n', 'htmlBlock']
	])('%s parses as %s, which is not prose', (source, kind) => {
		const target = block(source);
		expect(target.kind).toBe(kind);
		expect(isProseKind(target.kind)).toBe(false);
	});

	it('would otherwise destroy a link reference definition', () => {
		expect(block('[a]: /url\n').cycle(3, 0)?.newRaw).toBe('### [a]: /url\n');
	});
});
