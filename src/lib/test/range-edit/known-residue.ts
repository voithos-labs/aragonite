// The cuts whose plain-text paste back can't give the source back yet, each class named once with
// why and its smallest repro. The editor's own clipboard entry gives every one of them back (law 12
// holds on all), so these are gaps in what plain text carries. Two rows are pastes at a drawn caret
// beside a split tab, which no entry is part of. The law suites fail on a violation no class of
// their law matches, and the pin suite on a class whose repro passes: its fix deletes the row.

import type { Mode } from '#lib/range-edit/host.js';
import type { Range } from '#lib/range-edit/edit-range.js';
import type { LaidBlock } from '#lib/range-edit/layout.js';
import { containersAt, leafAt, readOf, type Read } from './expected';
import { blockHeldWhole } from './laws';
import type { CheckHost } from './test-host';

export interface KnownResidue {
	/** What plain text can't carry back, in one line. */
	gap: string;
	/** The lane whose fix deletes the row. */
	lane: 'tab columns' | '2b';
	/** The law it breaks: law 3, law 4's bytes past the range, law 9 at the caret the cut left or
	 *  at a drawn caret (a range with no bytes), law 11 at a drawn caret. */
	law: 'L3' | 'L4' | 'L9' | 'L11';
	matches(read: Read, range: Range, host: CheckHost): boolean;
	/** `text`: what a caret law's repro pastes. */
	repro: { source: string; mode: Mode; range: Range; text?: string };
}

/** The lines the range touches, its first and last whole. */
function coveredLines(read: Read, { from, to }: Range): string[] {
	const start = read.source.lastIndexOf('\n', from - 1) + 1;
	const end = read.source.indexOf('\n', to);
	return read.source.slice(start, end < 0 ? undefined : end).split('\n');
}

/** The text after `at` on its line, which a cut joins to the start's line. */
function restOfLine(read: Read, at: number): string {
	const end = read.source.indexOf('\n', at);
	return read.source.slice(at, end < 0 ? undefined : end);
}

const lineHead = (source: string, at: number) =>
	source.slice(source.lastIndexOf('\n', at - 1) + 1, at);

/** An end of the range right after a line's leading spaces, with the range crossing a line. */
const besideSpaces = (read: Read, { from, to }: Range) =>
	read.source.slice(from, to).includes('\n') &&
	[from, to].some((at) => /^[ \t]+$/.test(lineHead(read.source, at)));

/** Whether `a` and `b` sit in the same list of blocks. */
const besides = (a: LaidBlock, b: LaidBlock) =>
	a.path.length === b.path.length && a.path.slice(0, -1).join() === b.path.slice(0, -1).join();

/** The blocks directly inside `container`, its title row aside. */
function bodyOf(read: Read, container: LaidBlock, host: CheckHost): LaidBlock[] {
	const title = host.facts(container.type).titleRow?.type;
	return read.blocks.filter(
		(b) => b.path.slice(0, -1).join() === container.path.join() && b.type !== title
	);
}

export const KNOWN_RESIDUE: KnownResidue[] = [
	{
		gap: 'a tab split between a container marker and the line’s indent loses its columns',
		lane: 'tab columns',
		law: 'L3',
		matches: (read, range) =>
			coveredLines(read, range).some((line) => /^[ >*+\-\d.)]*\t/.test(line)),
		repro: { source: '2) 汉字\n    \n\t1. n', mode: 'live', range: { from: 4, to: 15 } }
	},
	{
		gap: 'a tab split between a container marker and the line’s indent joins as the spaces of its columns',
		lane: 'tab columns',
		law: 'L4',
		matches: (read, range) =>
			coveredLines(read, range).some((line) => /^[ >*+\-\d.)]*\t/.test(line)),
		repro: { source: ' - `c`\n\t> q\n\t\n\t**b**\n', mode: 'source', range: { from: 11, to: 14 } }
	},
	{
		gap: 'a tab split between a container marker and the line’s indent is read by its columns, which a new line’s markers and the question of two blocks reading as one count otherwise',
		lane: 'tab columns',
		law: 'L9',
		matches: (read, range) =>
			coveredLines(read, range).some((line) => /^[ >*+\-\d.)]*\t/.test(line)),
		repro: {
			source: '1.\t汉字\n\t> q\n\t- x\n\n>\t`c`\n   > 1. n\n`c`\n',
			mode: 'source',
			range: { from: 15, to: 31 }
		}
	},
	{
		gap: 'plain text at a caret before a tab split between a marker and the line’s indent takes later lines’ markers by its bytes, not its columns',
		lane: 'tab columns',
		law: 'L11',
		matches: (read, range) =>
			coveredLines(read, range).some((line) => /^[ >*+\-\d.)]*\t/.test(line)),
		repro: {
			source: '[^1]:> q\r\n\n\t- [ ] > q\r\n- x\n    \r\n\t       -\tword\n',
			mode: 'source',
			range: { from: 33, to: 33 },
			text: 'line one\nline two\n'
		}
	},
	{
		gap: 'a line that reads as a setext underline or a break (`---`, `- `) re-reads the paragraph above it',
		lane: '2b',
		law: 'L3',
		matches: (read, range) => {
			const below = read.source.indexOf('\n', range.to);
			const next = below < 0 ? '' : read.source.slice(below + 1).split('\n')[0];
			const copied = read.source.slice(range.from, range.to).split('\n');
			const joined = restOfLine(read, range.to);
			return [...coveredLines(read, range), next, ...copied, ...(joined ? [joined] : [])].some(
				(line) => /^[ >]*(?:-+|=+)[ \t]*\r?$/.test(line)
			);
		},
		repro: { source: 'Title\n===\n', mode: 'source', range: { from: 1, to: 9 } }
	},
	{
		gap: 'a line its container reads without a marker comes back with one, nested where it lands',
		lane: '2b',
		law: 'L3',
		matches: (read, range, host) => {
			const start = read.source.lastIndexOf('\n', range.from - 1) + 1;
			const marked = (type: string) =>
				['every-line', 'first-line'].includes(host.facts(type).lines);
			return read.blocks.some((b) =>
				(marked(b.type) ? (b.lines ?? []) : []).some(
					(line) =>
						!line.own &&
						line.markerTo === line.from &&
						line.from >= start &&
						line.from <= range.to &&
						read.source.slice(line.from, line.to).trim() !== ''
				)
			);
		},
		repro: {
			source:
				'> [!Warning]\r\n>\t>a\n   > - x\r\n`c`\n\r\n  [^n]:  >  > `c`\n    > q\r\n    > x y\n     >\t>\t\r\n     >\t > word\n',
			mode: 'source',
			range: { from: 32, to: 71 }
		}
	},
	{
		gap: 'a container pasted into the same kind joins the deepest one, not the depth it left',
		lane: '2b',
		law: 'L3',
		matches: (read, range) => {
			const types = containersAt(read, range.from, 'start').map((c) => c.type);
			return (
				types.some((type, i) => type !== 'list' && types.indexOf(type) !== i) ||
				types.filter((type) => type === 'list').length > 2
			);
		},
		repro: {
			source: '- i0\n  - i1\n    - i2\n  - i3\n    - i4\n\n    p5\n',
			mode: 'source',
			range: { from: 18, to: 44 }
		}
	},
	{
		gap: 'a container cut out past its end from past an opening line, or from its first text to or through a block that takes no joined text, nests a second one when pasted back',
		lane: '2b',
		law: 'L3',
		matches: (read, range, host) => {
			const takesNone = (b: LaidBlock | null | undefined) =>
				!!b && host.facts(b.type).joins === 'never';
			const endTakesNone = takesNone(leafAt(read, range.to));
			return containersAt(read, range.from, 'start').some((c) => {
				const first = read.blocks.find((b) => b.text && b.from >= c.from && b.to <= c.to);
				// The clipboard's last block: the last one beside the container the range takes whole.
				const last = read.blocks
					.filter((b) => besides(b, c) && b.from >= c.to && b.to <= range.to)
					.at(-1);
				const fromText = first?.text?.from === range.from && (endTakesNone || takesNone(last));
				return c.to < range.to && (c.lines!.at(0)!.own || fromText);
			});
		},
		repro: {
			source: '> [!TIP]\r\n> a\r\n>汉字\r\n   > word\r\n\r\n[^1]:- x\r\n     - x\r\n',
			mode: 'source',
			range: { from: 12, to: 41 }
		}
	},
	{
		gap: 'text cut from a container that takes no joined text can’t be handed back to it',
		lane: '2b',
		law: 'L3',
		matches: (read, range, host) => {
			const end = leafAt(read, range.to);
			if (!end || end.path.length < 2) return false;
			const owner = read.blocks.find((b) => b.path.join() === end.path.slice(0, -1).join());
			return !!owner && owner.from > range.from && host.facts(owner.type).joins === 'never';
		},
		repro: { source: 'a[^1]\n\n[^1]: b\n', mode: 'source', range: { from: 5, to: 13 } }
	},
	{
		gap: 'a container the cut empties at the document’s end, with no line ending, gives a paste no markers',
		lane: '2b',
		law: 'L3',
		matches: (read, range, host) =>
			!read.source.endsWith('\n') &&
			range.to === read.source.length &&
			containersAt(read, range.from, 'start').some(
				(c) =>
					c.to === read.source.length && bodyOf(read, c, host).every((b) => b.from >= range.from)
			),
		repro: { source: '> ```\n> x\n> ```', mode: 'source', range: { from: 2, to: 15 } }
	},
	{
		gap: 'two first-line markers on one line (`[^1]:1. `), cut out past their end, nest when pasted back',
		lane: '2b',
		law: 'L3',
		matches: (read, range, host) => {
			const left = containersAt(read, range.from, 'start').filter(
				(c) => c.to < range.to && host.facts(c.type).lines === 'first-line'
			);
			return left.some((outer) =>
				left.some(
					(inner) => inner !== outer && inner.from < outer.lines![0].to && inner.from > outer.from
				)
			);
		},
		repro: { source: '[^1]:1. n\r\n汉字\r\nword', mode: 'source', range: { from: 9, to: 17 } }
	},
	{
		gap: 'the spaces a cut leaves at a line’s start join the other side’s text and read as another block',
		lane: '2b',
		law: 'L3',
		matches: besideSpaces,
		repro: { source: 'p\n\n \n# h - x\n', mode: 'source', range: { from: 4, to: 8 } }
	},
	{
		gap: 'a cut from an unindented line a list item or footnote holds, or from the line right under one with an indented line after the range, leaves an empty line that container takes in: the paste back lands inside it, behind its indent',
		lane: '2b',
		law: 'L3',
		matches: (read, { from, to }, host) => {
			const marked = (b: LaidBlock) => host.facts(b.type).lines === 'first-line';
			// An item or a footnote that starts at the range's first byte is cut as a block of its own.
			if (
				lineHead(read.source, from) !== '' ||
				read.blocks.some((b) => b.from === from && marked(b))
			)
				return false;
			const below = read.source.indexOf('\n', to);
			const under = below < 0 ? '' : read.source.slice(below + 1);
			const indentedBelow = /^(?:[ \t]*\r?\n)*[ \t]+\S/.test(under);
			return read.blocks.some(
				(c) => marked(c) && c.from < from && (from < c.to || (from === c.to && indentedBelow))
			);
		},
		repro: {
			source: '1. word\n   a\n   \n       > - x\n\t> q\na\n   > \n',
			mode: 'source',
			range: { from: 35, to: 36 }
		}
	},
	{
		gap: 'a range ending inside an indented code block it enters: pasted back, what it copied of the block and the rest of that line read as two blocks',
		lane: '2b',
		law: 'L3',
		matches: (read, { from, to }, host) => {
			const end = leafAt(read, to);
			return (
				!!end &&
				host.facts(end.type).body === 'literal' &&
				/^(?: {4}|\t)/.test(read.source.slice(end.from)) &&
				from < end.from &&
				end.text!.from < to &&
				to < end.text!.to
			);
		},
		repro: { source: '- [ ] x y\r\n \n       汉字\r\n', mode: 'source', range: { from: 9, to: 21 } }
	},
	{
		gap: 'a range ending at the text of a block that takes no joined text keeps its marker, which the copy carries too',
		lane: '2b',
		law: 'L3',
		matches: (read, range, host) => {
			const end = leafAt(read, range.to);
			const lineStart = read.source.lastIndexOf('\n', range.to - 1) + 1;
			return (
				!!end &&
				end.text!.from === range.to &&
				range.from < lineStart &&
				lineStart < range.to &&
				host.facts(end.type).joins === 'never'
			);
		},
		repro: { source: 'p\n\n  \n \n> - - -\n', mode: 'source', range: { from: 3, to: 10 } }
	},
	{
		gap: 'a range from an indented code block’s first byte takes its indent, so the rest reads as a paragraph',
		lane: '2b',
		law: 'L3',
		matches: (read, range, host) =>
			read.blocks.some(
				(b) =>
					b.from === range.from &&
					range.to < b.to &&
					host.facts(b.type).body === 'literal' &&
					/^(?: {4}|\t)/.test(read.source.slice(b.from))
			),
		repro: { source: '    word\n', mode: 'source', range: { from: 0, to: 6 } }
	},
	{
		gap: 'an HTML block cut from its first byte, save one held whole at the top level, pastes back as blocks apart from what the cut left',
		lane: '2b',
		law: 'L3',
		matches: (read, range) =>
			read.blocks.some((b) => b.type === 'htmlBlock' && b.from === range.from) &&
			blockHeldWhole(read, range)?.path.length !== 1,
		repro: {
			source: '- <!-- a note -->\n- <!-- a note -->\n',
			mode: 'source',
			range: { from: 2, to: 17 }
		}
	},
	{
		gap: 'a range ending inside an HTML block it enters joins the rest of that line to where it began',
		lane: '2b',
		law: 'L3',
		matches: (read, range) =>
			read.blocks.some(
				(b) =>
					b.type === 'htmlBlock' &&
					range.from < b.from &&
					b.from < range.to &&
					range.to < (b.text?.to ?? b.to)
			),
		repro: {
			source: '> two\n\n<table><tr><td>cell</td></tr></table>\n',
			mode: 'source',
			range: { from: 5, to: 38 }
		}
	}
];

/** The known class of `law` a violation on `range` of `source` belongs to, if any. */
export function knownResidue(
	host: CheckHost,
	source: string,
	range: Range,
	law: KnownResidue['law'] = 'L3'
): KnownResidue | null {
	const read = readOf(host, source);
	return (
		KNOWN_RESIDUE.find((known) => known.law === law && known.matches(read, range, host)) ?? null
	);
}
