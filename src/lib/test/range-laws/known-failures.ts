// The law violations the editor commits today, each class named once with its issue, the lane
// that fixes it, a pattern over its violation lines and its smallest repro. The gated suite fails
// on a violation no class matches, and on a class whose repro passes: the fix that closes a class
// deletes its row.

import type { LawRun } from './laws';
import type { LawSpec } from './law-specs';
import { ISSUE_DOCUMENTS } from './shapes';

export interface KnownViolation {
	/** The issue the class is filed as, or `new: <slug>` until it is. */
	issue: string;
	/** The lane whose fix deletes the row. */
	lane: 'issues-four' | 'range-removal' | 'rebuild';
	/** What's broken, in one line. */
	defect: string;
	/** Matches the class's violation lines, which open `L<law>[.<label>] [<shape>] <gesture> <mode>/<eol>: `. */
	lines: RegExp;
	/** What the two quoted texts in the line (what came out, what the law wanted) still share, so a
	 *  second defect in the same shape isn't taken for this one. */
	keeps?: (got: string, wanted: string) => boolean;
	/** The law and the arguments its spec's run takes, smallest first found. */
	repro: { law: LawSpec['law']; args: unknown };
}

const end = (site: number, at: 'start' | 'end' | 'inside', inside = 0) => ({ site, at, inside });

/** The same text, the line breaks and blank lines between it aside. */
const sameBesideBreaks = (got: string, wanted: string) =>
	got.replace(/\s+/g, '') === wanted.replace(/\s+/g, '');

/** The same words, the containers' line markers (a list number and a footnote label included),
 *  punctuation and spacing aside. */
const sameWords = (got: string, wanted: string) => words(got) === words(wanted);

const words = (text: string) =>
	text
		.replace(/\[\^[^\]]*\]:|\[![A-Za-z]+\]/g, '')
		.replace(/(^|\n)[ \t>]*(?:\d{1,9}[.)])?/g, '$1')
		.replace(/[^\p{L}\p{N}]/gu, '');

/** The same characters in another order, whitespace aside. */
const sameCharacters = (got: string, wanted: string) => characters(got) === characters(wanted);

const characters = (text: string) => [...text.replace(/\s+/g, '')].sort().join('');

/** How many lines of `text` `pattern` (a multiline, global one) starts. */
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

const TABLE_LINE = /^[ \t>]*\|/gm;
const ITEM_MARKER = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])(?=[ \t]|\r?$)/gm;
const ALERT_MARKER = /^[ \t>]*\[![A-Za-z]+\]/gm;
const FENCE_LINE = /^[ \t>]*(?:`{3,}|~{3,})/gm;

/** Most specific first: a line counts toward the first row it matches. */
export const KNOWN_VIOLATIONS: readonly KnownViolation[] = [
	{
		issue: '#818',
		lane: 'rebuild',
		defect: 'a cut across blocks, pasted back at the caret it left, splits what the cut joined',
		lines: /^L3 \[[^\]]*→/,
		keeps: sameBesideBreaks,
		repro: {
			law: 'L3',
			args: [
				{
					source: ISSUE_DOCUMENTS['#818'],
					mode: 'source',
					seed: { a: end(0, 'inside', 4), b: end(1, 'inside', 6) }
				},
				'key',
				'key'
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect: 'a cut from text into a table, pasted back, loses the table rows it took',
		lines: /^L3 \[[^\]]*→ table\]/,
		keeps: (got, wanted) => count(got, TABLE_LINE) < count(wanted, TABLE_LINE),
		repro: {
			law: 'L3',
			args: [
				{
					source: 'x\n# h\n| A | B |\n| - | - |\n',
					mode: 'source',
					seed: { a: end(2, 'start'), b: end(0, 'start') }
				},
				'key',
				'key'
			]
		}
	},
	{
		issue: '#818',
		lane: 'rebuild',
		defect: 'a cut across a container edge, pasted back, puts the container’s lines back wrong',
		lines: /^L3 \[[^\]]*→/,
		keeps: sameWords,
		repro: {
			law: 'L3',
			args: [
				{
					source: ISSUE_DOCUMENTS['#815'],
					mode: 'source',
					seed: { a: end(0, 'inside', 4), b: end(2, 'inside', 5) }
				},
				'key',
				'key'
			]
		}
	},
	{
		issue: '#818',
		lane: 'rebuild',
		defect: 'blocks pasted at a caret in text join neither to the text before nor the text after',
		lines: /^L9(?:\.prefix)? \[[^\]]*\] paste:\S+ blocks/,
		keeps: sameWords,
		repro: {
			law: 'L9',
			args: [
				{ source: 'alpha bravo\n', mode: 'source', caret: end(0, 'inside', 4) },
				'one\n\ntwo',
				'key'
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect:
			'a whole alert or fence cut and pasted back lands inside its own kind (a nested alert, a wider fence)',
		lines: /^L3 \[(?:document \| fencedCode|[^\]]*githubAlert>paragraph → githubAlert)/,
		keeps: (got, wanted) =>
			count(got, ALERT_MARKER) > count(wanted, ALERT_MARKER) ||
			count(got, FENCE_LINE) > count(wanted, FENCE_LINE),
		repro: {
			law: 'L3',
			args: [
				{
					source: '```\ncode();\n```\n\n| H0 |\n| --- |\n',
					mode: 'live',
					seed: { a: end(0, 'start'), b: end(0, 'start') }
				},
				'key at body',
				'key'
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect: 'Enter over a range inside a list splits into items a cut then Enter never makes',
		lines: /^L5 \[listItem \| [^\]]*\] type:Enter /,
		keeps: (got, wanted) => count(got, ITEM_MARKER) > count(wanted, ITEM_MARKER),
		repro: {
			law: 'L5',
			args: [
				{
					source: '- a\r\n\r\n  a\r\n\r\n- >a\r\n',
					mode: 'source',
					seed: { a: end(0, 'start'), b: end(21, 'start', 3) }
				},
				{ typed: { key: 'Enter' } }
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect:
			'a cut inside one block, pasted straight back, changes the block (a live heading’s `#`, respelled container lines, line endings)',
		lines: /^L3 \[[^\]→]*\]/,
		keeps: sameWords,
		repro: {
			law: 'L3',
			args: [
				{
					source: '> > # word\n> > **b**\n',
					mode: 'live',
					seed: { a: end(0, 'start'), b: end(0, 'start') }
				},
				'key',
				'insertMarkdown'
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect:
			'Enter, a key or a paste over a range lands other than a cut then the same gesture (fences, footnotes, quotes, trailing line endings)',
		lines: /^L5 /,
		keeps: sameWords,
		repro: {
			law: 'L5',
			args: [
				{
					source: ':::note\r\n:::\r\n\r\none',
					mode: 'source',
					seed: { a: end(31, 'start'), b: end(15, 'start') }
				},
				{ typed: { key: 'Enter' } }
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect:
			'a range gesture fires a dev check: Enter over a range (`command-key-landing`), a paste or a delete in a quote (`stale-raw`)',
		lines:
			/^L8 \[[^\]]*→[^\]]*\] (?:type:Enter \S+: fired invariant:command-key-landing|(?:paste:\S+|Backspace|Delete) \S+: fired invariant:stale-raw)$/,
		repro: {
			law: 'L8',
			args: [
				{
					source:
						'>a\r\n\n>> `c`\r\n>>\t\n>>a\r\n > `c`\n> 汉字\r\n>> \n> > - x\r\n`c`\n>`c`\r\n\n>a\r\n',
					mode: 'live',
					seed: { a: end(3, 'start'), b: end(4, 'start') }
				},
				{ plain: '# not a heading' }
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect:
			'a paste at a caret rewrites the container prefix of the line it lands on (`  [^n]: ` to `[^n]: `, `>a` to `> a`, a tab to spaces)',
		lines: /^L9\.prefix /,
		keeps: sameWords,
		repro: {
			law: 'L9',
			args: [
				{ source: '  [^n]: a\n', mode: 'source', caret: end(0, 'start') },
				'line one\nline two\n',
				'menu'
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect:
			'in live mode, text pasted at a caret past a hidden closing run goes inside the run, not at the offset the selection reports',
		lines: /^L9 \[[^\]]*\] paste:\S+ text live\//,
		keeps: sameCharacters,
		repro: {
			law: 'L9',
			args: [{ source: 'a **b**\n', mode: 'live', caret: end(0, 'end') }, 'x', 'key']
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect:
			'a copy whose end sits at the edge of a block it holds whole takes that block’s markers or line ending',
		lines: /^L10\.edge /,
		keeps: sameWords,
		repro: {
			law: 'L10',
			args: [
				{ source: 'a\n- b\n', mode: 'live', seed: { a: end(60, 'end', 5), b: end(59, 'end', 2) } },
				'key at body'
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect:
			'undo of a live paste past a hidden closing run puts the caret where the text went, not where the paste began',
		lines: /^L7\.caret \[[^\]]*\] paste:\S+ live\//,
		repro: {
			law: 'L7',
			args: [
				{ source: 'a **b**\n', mode: 'live', caret: end(0, 'end') },
				{ replacement: { pasted: 'x', route: 'key' } }
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect: 'Backspace or Delete over some ranges across blocks leaves the bytes as they were',
		lines: /^L4\.unchanged /,
		repro: {
			law: 'L4',
			args: [
				{
					source: '# head\n\ntwo words\ntwo words\n# head\n',
					mode: 'source',
					seed: { a: end(1, 'end'), b: end(63, 'start', 28) }
				},
				'Backspace'
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect:
			'Paste as plain text rewrites bytes away from the caret (a line’s container prefix, a live autolink’s hidden `>`) or escapes text in an indented code block',
		lines:
			/^L11 \[[^\]]*\] paste:plain \S+: "(?:[^"\\]|\\.)*" into (?:indentedCode put in|\w+ changed bytes away)/,
		repro: {
			law: 'L11',
			args: [{ source: '<http://a.b>\n', mode: 'live', caret: end(62, 'end', 48) }, '1. one']
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect: 'a paste into indented code or a link definition fires the `paste-dispatch` dev check',
		lines: /^L8 .*: fired paste-dispatch$/,
		repro: {
			law: 'L8',
			args: [
				{
					source: '    code\r\n\r\n> | H0 |\r\n> | --- |\r\n',
					mode: 'source',
					caret: end(0, 'start')
				},
				{ replacement: { pasted: 'x', route: 'key' } }
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect: 'a copy ending at the start of a list item’s text leaves out the item’s marker',
		lines: /^L10 \[[^\]]*→ [^\]]*listItem>paragraph\] /,
		keeps: (got, wanted) =>
			wanted.startsWith(got) &&
			/^[\s>]*(?:[-*+]|\d{1,9}[.)])[ \t]*$/.test(wanted.slice(got.length)),
		repro: {
			law: 'L10',
			args: [
				{
					source: '# h\n- a\n',
					mode: 'live',
					seed: { a: end(44, 'start'), b: end(63, 'start', 31) }
				},
				'key at body'
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect:
			'a paste in a mixed-ending document swaps the caret line’s ending with the pasted line’s',
		lines: /^L9 \[[^\]]*\] paste:\S+ text \w+\/mixed: /,
		keeps: (got, wanted) =>
			got !== wanted && got.replace(/\r\n/g, '\n') === wanted.replace(/\r\n/g, '\n'),
		repro: {
			law: 'L9',
			args: [
				{
					source: '- a\r\n  - x\n\r\n  a\n\r\n  a\na\r\n  > q\n',
					mode: 'source',
					caret: end(12, 'start')
				},
				'a\nb',
				'menu'
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect:
			'a paste at the start of a paragraph just above a fence adds a blank line after the text',
		lines: /^L9 \[document \| paragraph\] paste:\S+ text /,
		keeps: (got, wanted) =>
			got.length === wanted.length + 1 &&
			[...got].some((ch, i) => ch === '\n' && got.slice(0, i) + got.slice(i + 1) === wanted),
		repro: {
			law: 'L9',
			args: [
				{ source: '    code\n\n\n```\n```\n\n    code\n', mode: 'source', caret: end(1, 'start') },
				'x',
				'menu'
			]
		}
	},
	{
		issue: '#819',
		lane: 'rebuild',
		defect: 'a paste at an empty quote line keeps that line above the pasted ones',
		lines: /^L9 \[(?:githubAlert|blockquote) \| paragraph\] paste:\S+ text /,
		keeps: (got, wanted) =>
			sameWords(got, wanted) && count(got, /\n/g) === count(wanted, /\n/g) + 1,
		repro: {
			law: 'L9',
			args: [
				{
					source: '> [!NOTE]\r\n>\r\n>\r\n> two words\r\n> three',
					mode: 'source',
					caret: end(54, 'end', 58)
				},
				'a\nb',
				'insertMarkdown'
			]
		}
	}
];

/** The known class a line belongs to, or null. */
export const knownClassOf = (line: string): KnownViolation | null =>
	KNOWN_VIOLATIONS.find((row) => row.lines.test(line) && keepsWhatItShould(row, line)) ?? null;

function keepsWhatItShould(row: KnownViolation, line: string): boolean {
	if (!row.keeps) return true;
	const quoted = [...line.slice(line.indexOf(': ')).matchAll(/"((?:[^"\\]|\\.)*)"/g)];
	if (quoted.length < 2) return false;
	const [got, wanted] = quoted.map((m) => JSON.parse(`"${m[1]}"`) as string);
	return row.keeps(got, wanted);
}

/** The lines of `run` about `law` that no known class matches. */
export function unknownLines(run: LawRun, isOwn: (line: string) => boolean): string[] {
	return run.lines.filter((line) => isOwn(line) && !knownClassOf(line));
}
