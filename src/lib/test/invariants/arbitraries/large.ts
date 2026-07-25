import fc from 'fast-check';

/**
 * Inputs at the scale the complexity defects actually live at. The standard
 * lanes top out in the hundreds of bytes, while every superlinear-growth and
 * overflow defect the reviews measured sits three or four orders of magnitude
 * past that — a quadratic inline decline, an argument-spread `RangeError` at
 * tens of thousands of matches, a render recursion's stack overflow. No flood
 * and no long run was expressible in the input space at all, so the marquee
 * round-trip invariant was structurally blind to the whole class.
 *
 * Drawn at a low run count: the point is reaching the scale, not sampling it
 * densely, and the shapes are chosen rather than searched.
 */

/** Roughly the byte budget each drawn document aims for. */
const TARGET_BYTES = 100_000;

/**
 * One flood of a single character. Delimiter runs matter most — a long run is
 * the construct that actually nests, unlike the bracket flood, which cannot
 * (an enclosing link opener is deactivated), so it is the shape that reaches
 * the deep-recursion and quadratic-scan paths.
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
 * A document assembled from the shapes above until it passes the byte target.
 * Concatenating them is deliberate: a flood ABUTTING a structured block is
 * where a boundary-scan defect surfaces, and neither piece alone reaches it.
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
