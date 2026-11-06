// The cuts whose plain-text paste back can't give the source back yet, each class named once with
// why and its smallest repro. The editor's own clipboard entry gives every one of them back (law 12
// holds on all), so these are gaps in what plain text carries. The law suite fails on a law 3
// violation no class matches, and the pin suite on a class whose repro passes: its fix deletes the row.

import type { Mode } from '#lib/range-edit/host.js';
import type { Range } from '#lib/range-edit/edit-range.js';
import { containersAt, leafAt, readOf, type Read } from './expected';
import type { CheckHost } from './test-host';

export interface KnownResidue {
	/** What plain text can't carry back, in one line. */
	gap: string;
	/** The lane whose fix deletes the row. */
	lane: 'tab columns' | 'range core';
	matches(read: Read, range: Range, host: CheckHost): boolean;
	repro: { source: string; mode: Mode; range: Range };
}

/** The lines the range touches, its first and last whole. */
function coveredLines(read: Read, { from, to }: Range): string[] {
	const start = read.source.lastIndexOf('\n', from - 1) + 1;
	const end = read.source.indexOf('\n', to);
	return read.source.slice(start, end < 0 ? undefined : end).split('\n');
}

export const KNOWN_RESIDUE: KnownResidue[] = [
	{
		gap: 'a tab split between a container marker and the line’s indent loses its columns',
		lane: 'tab columns',
		matches: (read, range) =>
			coveredLines(read, range).some((line) => /^[ >*+\-\d.)]*\t/.test(line)),
		repro: { source: '2) 汉字\n    \n\t1. n', mode: 'live', range: { from: 4, to: 15 } }
	},
	{
		gap: 'a line that reads as a setext underline (`---`, `- `) re-reads the paragraph above it',
		lane: 'range core',
		matches: (read, range) => {
			const below = read.source.indexOf('\n', range.to);
			const next = below < 0 ? '' : read.source.slice(below + 1).split('\n')[0];
			return [...coveredLines(read, range), next].some((line) =>
				/^[ >]*(?:-+|=+)[ \t]*\r?$/.test(line)
			);
		},
		repro: { source: 'a\n# h\n---\n', mode: 'source', range: { from: 1, to: 6 } }
	},
	{
		gap: 'a line its container reads without a marker comes back with one, nested where it lands',
		lane: 'range core',
		matches: (read, range, host) => {
			const start = read.source.lastIndexOf('\n', range.from - 1) + 1;
			const marked = (type: string) =>
				['every-line', 'first-line'].includes(host.facts(type).lines);
			return read.layout.blocks.some((b) =>
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
			source: '> [!NOTE]\n   > `c`\nword\nword\n\n[^1]:- x\n- x',
			mode: 'live',
			range: { from: 15, to: 38 }
		}
	},
	{
		gap: 'a container pasted into the same kind joins the deepest one, not the depth it left',
		lane: 'range core',
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
		gap: 'a container with an opening line, cut from its text out past its end, nests a second one when pasted back',
		lane: 'range core',
		matches: (read, range) =>
			containersAt(read, range.from, 'start').some((c) => c.to < range.to && c.lines!.at(0)!.own),
		repro: {
			source: '> [!TIP]\r\n> a\r\n>汉字\r\n   > word\r\n\r\n[^1]:- x\r\n     - x\r\n',
			mode: 'source',
			range: { from: 12, to: 41 }
		}
	},
	{
		gap: 'text cut from a container that takes no joined text can’t be handed back to it',
		lane: 'range core',
		matches: (read, range, host) => {
			const end = leafAt(read, range.to);
			if (!end || end.path.length < 2) return false;
			const owner = read.layout.blocks.find((b) => b.path.join() === end.path.slice(0, -1).join());
			return !!owner && owner.from > range.from && host.facts(owner.type).joins === 'never';
		},
		repro: { source: 'a[^1]\n\n[^1]: b\n', mode: 'source', range: { from: 5, to: 13 } }
	}
];

/** The known class a law 3 violation on `range` of `source` belongs to, if any. */
export function knownResidue(host: CheckHost, source: string, range: Range): KnownResidue | null {
	const read = readOf(host, source);
	return KNOWN_RESIDUE.find((known) => known.matches(read, range, host)) ?? null;
}
