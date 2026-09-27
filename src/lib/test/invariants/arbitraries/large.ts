import fc from 'fast-check';
import { withDrawnLineEnding } from './line-endings';

/**
 * Inputs at the scale where superlinear growth and overflow defects live: three or four orders of
 * magnitude past the standard generators, which top out in the hundreds of bytes. Drawn at a low
 * run count, because the point is reaching that scale, not sampling it densely.
 */

/** Every multi-unit class on one mostly-ASCII line, since an offset defect at 100KB is still an
 *  offset defect. */
const NON_ASCII_LINE = '汉字 \u00e9m e\u0301m 😀 x';

const TARGET_BYTES = 100_000;

/** A flood of one character; a delimiter run nests, which is what reaches the deep-recursion and
 *  quadratic-scan paths. */
const flood = fc
	.tuple(
		fc.constantFrom('>', '*', '_', '~', '`', '[', ']', '#', '-', '=', '\\', '|'),
		fc.integer({ min: 4_000, max: 20_000 })
	)
	.map(([char, count]) => char.repeat(count) + '\n');

/** A run of blank lines: the blank-line path, which is walked once per line. */
const blankRun = fc.integer({ min: 4_000, max: 20_000 }).map((count) => '\n'.repeat(count));

/** Many small blocks: tens of thousands of inline matches in one document. */
const manyBlocks = fc
	.tuple(
		fc.constantFrom(
			'a *b* c\n',
			'| x | y |\n',
			'- item\n',
			'> q\n',
			'`c` d\n',
			`${NON_ASCII_LINE}\n`
		),
		fc.integer({ min: 2_000, max: 8_000 })
	)
	.map(([line, count]) => line.repeat(count));

/** One line with no ending: the unterminated-at-end-of-file path, at scale. */
const longLine = fc
	.tuple(
		fc.constantFrom('word ', 'a*b ', '\\* ', 'x`y` ', `${NON_ASCII_LINE} `),
		fc.integer({ min: 4_000, max: 15_000 })
	)
	.map(([unit, count]) => unit.repeat(count));

/** An unclosed container: the parser absorbs to EOF, so it absorbs 100KB. */
const unclosedFence = fc
	.integer({ min: 4_000, max: 15_000 })
	.map((count) => '```js\n' + 'code();\n'.repeat(count));

/**
 * A document assembled from the shapes above until it passes the byte target. Abutting
 * them is deliberate: a boundary-scan defect needs a flood adjoining a structured block.
 */
export const arbLargeDoc = withDrawnLineEnding(
	fc
		.array(fc.oneof(flood, blankRun, manyBlocks, longLine, unclosedFence), {
			minLength: 1,
			maxLength: 4
		})
		.map((parts) => {
			let source = parts.join('');
			while (source.length < TARGET_BYTES) source += parts[0];
			return source;
		})
);
