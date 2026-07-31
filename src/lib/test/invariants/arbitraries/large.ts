import fc from 'fast-check';

/**
 * Inputs at the scale superlinear-growth and overflow defects live at — three or four
 * orders of magnitude past the standard lanes, which top out in the hundreds of bytes.
 * Drawn at a low run count: the point is reaching the scale, not sampling it densely.
 */

/** Roughly the byte budget each drawn document aims for. */
const TARGET_BYTES = 100_000;

/**
 * One flood of a single character. A delimiter run is the shape that reaches the
 * deep-recursion and quadratic-scan paths, because unlike a bracket flood it nests.
 */
const flood = fc
	.tuple(
		fc.constantFrom('>', '*', '_', '~', '`', '[', ']', '#', '-', '=', '\\', '|'),
		fc.integer({ min: 4_000, max: 20_000 })
	)
	.map(([char, count]) => char.repeat(count) + '\n');

/** A run of blank lines — the trivia path, which is walked per blank line. */
const blankRun = fc.integer({ min: 4_000, max: 20_000 }).map((count) => '\n'.repeat(count));

/** Many small blocks: tens of thousands of inline matches in one document. */
const manyBlocks = fc
	.tuple(
		fc.constantFrom('a *b* c\n', '| x | y |\n', '- item\n', '> q\n', '`c` d\n'),
		fc.integer({ min: 2_000, max: 8_000 })
	)
	.map(([line, count]) => line.repeat(count));

/** One line with no ending — the unterminated-at-EOF path at scale. */
const longLine = fc
	.tuple(fc.constantFrom('word ', 'a*b ', '\\* ', 'x`y` '), fc.integer({ min: 4_000, max: 15_000 }))
	.map(([unit, count]) => unit.repeat(count));

/** An unclosed container: the parser absorbs to EOF, so it absorbs 100KB. */
const unclosedFence = fc
	.integer({ min: 4_000, max: 15_000 })
	.map((count) => '```js\n' + 'code();\n'.repeat(count));

/**
 * A document assembled from the shapes above until it passes the byte target. Abutting
 * them is deliberate: a boundary-scan defect needs a flood adjoining a structured block.
 */
export const arbLargeDoc = fc
	.array(fc.oneof(flood, blankRun, manyBlocks, longLine, unclosedFence), {
		minLength: 1,
		maxLength: 4
	})
	.map((parts) => {
		let source = parts.join('');
		while (source.length < TARGET_BYTES) source += parts[0];
		return source;
	});
