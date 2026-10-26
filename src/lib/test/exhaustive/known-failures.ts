// The defects the exhaustive suites already know about, each named once with a pattern over its
// failure lines, so a fix clears every input the defect reached and a longer input reaching it
// needs no entry. A suite fails on a failure no defect matches, and on a defect that matched
// nothing in a run long enough to reach it.

import { expect } from 'vitest';
import { LISTED_FAILURES } from './alphabet';

interface KnownDefect {
	suite: string;
	/** What's broken, in one line. */
	defect: string;
	/** The shortest input that reaches the defect; a shorter run doesn't expect a match. */
	from: number;
	/** Matches the defect's failure lines, which open `"<input>" [<path>]@<offset> <edit>: `. */
	lines: RegExp;
}

/** A JSON string in a failure line. */
const STR = String.raw`"(?:[^"\\]|\\.)*"`;
const at = (edit: string) => String.raw`^${STR} \[[\d,]*\]@\d+ ${edit}: `;
const re = (...parts: string[]) => new RegExp(parts.join(''));

export const KNOWN_DEFECTS: readonly KnownDefect[] = [
	{
		suite: 'edits',
		defect: 'some splits of a two-line block fire a tree-ops warning',
		from: 4,
		lines: re(at('split'), 'fired tree-ops$')
	},
	{
		suite: 'edits',
		defect: "a delete off an empty quote's line above a blank line leaves the quote with no block",
		from: 4,
		lines: re(at('delete after'), '.*live has 0 children.*fired invariant:keeps-a-block')
	},
	{
		suite: 'edits',
		defect: 'a space typed at the start of a one-cell table row writes no bytes',
		from: 4,
		lines: re(
			String.raw`^"[^"]*\|[^"]*" \[\d+,\d+,\d+\]@0 type " ": landed, but the bytes are the input$`
		)
	}
];

/** Holds `failures`, from every input up to `maxLength` long, to the known defects of `suite`. */
export function holdToKnownFailures(suite: string, failures: string[], maxLength: number): void {
	const known = KNOWN_DEFECTS.filter((entry) => entry.suite === suite);
	const unknown = failures.filter((failure) => !known.some((entry) => entry.lines.test(failure)));
	const fixed = known
		.filter((entry) => entry.from <= maxLength)
		.filter((entry) => !failures.some((failure) => entry.lines.test(failure)))
		.map((entry) => entry.defect);
	expect(
		{ unknown: unknown.slice(0, LISTED_FAILURES), fixed },
		`${unknown.length} failures no known defect matches, ${fixed.length} defects nothing reached; ` +
			'name a new defect in KNOWN_DEFECTS, or delete the entry of one a fix closed'
	).toEqual({ unknown: [], fixed: [] });
}
