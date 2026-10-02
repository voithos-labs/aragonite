import fc from 'fast-check';
import { withDrawnLineEnding } from './line-endings';

// Valid-ish GFM source strings, whose job is reaching the structured parser paths raw garbage
// rarely does. Structural validity is never required: round-trip preserves bytes either way, so a
// malformed draw is signal, not a false failure.

// ── Leaf-block source fragments ─────────────────────────────────────────────

// A minority of the bytes: these words exercise offset arithmetic (a multi-unit scalar under a
// slice), not the block grammar, so a rate that reaches every structural path is enough.
export const nonAsciiWord = fc.constantFrom('汉字', '\u00e9m', 'e\u0301m', '😀', '👩‍👦');

/** Construct-starting bytes inside prose, so a pipe line that is not a table, or a block marker
 *  mid-line, can be drawn at all. */
const mintingWord = fc.constantFrom('|', 'a | b', '|x|', '#', '>', '- x', ':::', '`|`', '---');

const inlineText = fc
	.array(
		fc.oneof(
			{ arbitrary: fc.constantFrom('word', 'lorem', 'x', '42'), weight: 4 },
			{ arbitrary: fc.constantFrom('**b**', '_i_', '`c`', '~~s~~'), weight: 4 },
			{
				arbitrary: fc.constantFrom('[t](u)', '![a](i.png)', '&copy;', '\\*', '<br>'),
				weight: 4
			},
			{
				arbitrary: fc.constantFrom(
					'foo@bar.com',
					'mailto:foo@bar.com',
					'xmpp:foo@bar.com/r',
					'<https://x.com>',
					'www.x.com'
				),
				weight: 4
			},
			{ arbitrary: mintingWord, weight: 3 },
			{ arbitrary: nonAsciiWord, weight: 2 }
		),
		{ minLength: 1, maxLength: 5 }
	)
	.map((words) => words.join(' '));

const heading = fc
	.tuple(fc.integer({ min: 1, max: 6 }), inlineText)
	.map(([level, text]) => '#'.repeat(level) + ' ' + text + '\n');

const setextHeading = fc
	.tuple(inlineText, fc.constantFrom('=', '-'))
	.map(([text, under]) => text + '\n' + under.repeat(3) + '\n');

const paragraph = fc
	.array(inlineText, { minLength: 1, maxLength: 3 })
	.map((lines) => lines.join('\n') + '\n');

const fencedCode = fc
	.tuple(
		fc.constantFrom('```', '~~~', '````'),
		fc.constantFrom('', 'js', 'rust', 'ts'),
		fc.array(fc.constantFrom('code();', '  indented', 'x = 1', ''), { maxLength: 4 })
	)
	.map(
		([fence, lang, body]) => fence + lang + '\n' + body.map((l) => l + '\n').join('') + fence + '\n'
	);

const indentedCode = fc
	.array(fc.constantFrom('code', 'x = 1', 'more'), { minLength: 1, maxLength: 3 })
	.map((lines) => lines.map((l) => '    ' + l + '\n').join(''));

const thematicBreak = fc.constantFrom('---\n', '***\n', '___\n', '- - -\n');

const linkRefDef = fc
	.tuple(
		fc.constantFrom('ref', 'my ref', 'go'),
		fc.constantFrom('https://example.com', '<https://x.com>'),
		fc.constantFrom('', ' "Title"', " 'T'", ' (T)')
	)
	.map(([label, url, title]) => `[${label}]: ${url}${title}\n`);

// headerDelta lets the header and delimiter cell counts disagree, which GFM §4.10 makes a
// paragraph; a line with no pipe after the rows is one more row (GFM example 201).
const table = fc
	.tuple(
		fc.integer({ min: 1, max: 3 }),
		fc.integer({ min: -1, max: 1 }),
		fc.array(fc.constantFrom('a', 'b', '1', 'x | y', ''), { minLength: 0, maxLength: 2 }),
		fc.constantFrom('', 'plain words\n')
	)
	.map(([cols, headerDelta, bodyCells, pipelessRow]) => {
		const headerCols = Math.max(1, cols + headerDelta);
		const header =
			'| ' + Array.from({ length: headerCols }, (_, i) => 'H' + i).join(' | ') + ' |\n';
		const delim = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |\n';
		const rows = bodyCells
			.map((cell) => '| ' + Array.from({ length: cols }, () => cell).join(' | ') + ' |\n')
			.join('');
		return header + delim + rows + pipelessRow;
	});

// ── Respelled tables ────────────────────────────────────────────────────────

const cellPad = fc.constantFrom('', ' ', '  ', '   ', '\t');
const cellText = fc.constantFrom('a', '1', '', 'x \\| y', '汉字', 'é', '**b**', '`c`');
const delimiterCell = fc.constantFrom('-', '---', ':-', ':--', '-:', ':-:', ':---:', '---:');

/** One table line in any spelling GFM reads the same: pipes at either end or not, cells padded
 *  with nothing, spaces or a tab, and an indent or trailing whitespace around the line. */
function spelledLine(cell: fc.Arbitrary<string>, count: number): fc.Arbitrary<string> {
	return fc
		.tuple(
			fc.array(fc.tuple(cellPad, cell, cellPad), { minLength: count, maxLength: count }),
			fc.boolean(),
			fc.boolean(),
			fc.constantFrom('', ' ', '   '),
			fc.constantFrom('', ' ', '\t')
		)
		.map(
			([cells, lead, trail, indent, tail]) =>
				indent +
				(lead ? '|' : '') +
				cells.map(([before, text, after]) => before + text + after).join('|') +
				(trail ? '|' : '') +
				tail +
				'\n'
		);
}

/** A table whose rows are spelled every way GFM allows, some of them short or with surplus. */
const respelledTable = fc.integer({ min: 1, max: 3 }).chain((cols) =>
	fc
		.tuple(
			spelledLine(cellText, cols),
			spelledLine(delimiterCell, cols),
			fc.array(
				fc
					.integer({ min: Math.max(1, cols - 1), max: cols + 1 })
					.chain((n) => spelledLine(cellText, n)),
				{ maxLength: 3 }
			)
		)
		.map(([header, delimiter, rows]) => header + delimiter + rows.join(''))
);

/** Respelled tables at the top level and inside a quote, a blank line apart. */
export const arbRespelledTableDoc = withDrawnLineEnding(
	fc
		.array(
			fc.oneof(
				{ arbitrary: respelledTable, weight: 3 },
				{
					arbitrary: respelledTable.map((t) => t.replace(/^(?=.)/gm, '> ')),
					weight: 1
				}
			),
			{ minLength: 1, maxLength: 3 }
		)
		.map((tables) => tables.join('\n'))
);

// ── Respelled quotes and lists ──────────────────────────────────────────────

/** A body line before its container's prefix: `lazy` marks a paragraph line after its first,
 *  the only kind GFM lets go without a prefix. */
interface DrawnLine {
	text: string;
	lazy: boolean;
}

const bodyWord = fc.constantFrom('a', 'word', 'x y', '汉字', '**b**', '`c`', '- x', '> q', '1. n');

const drawnParagraph = fc
	.array(bodyWord, { minLength: 1, maxLength: 3 })
	.map((lines): DrawnLine[] => lines.map((text, i) => ({ text, lazy: i > 0 })));

/** A line in any spelling a quote reads the same: the marker's optional space or a tab, up to
 *  three spaces before it, a lazy paragraph line with none at all. */
function quoteSpelling(line: DrawnLine): fc.Arbitrary<string> {
	if (line.text === '') return fc.constantFrom('>', '> ', ' >', '>\t');
	const marked = fc
		.constantFrom('>', '> ', '>\t', ' > ', '   > ')
		.map((marker) => marker + line.text);
	return line.lazy ? fc.oneof(marked, fc.constant(line.text)) : marked;
}

/** A continuation line of an item whose content starts at `column`: the indent in spaces, in a
 *  tab, past the content column, and for a lazy line none. */
function itemSpelling(line: DrawnLine, column: number): fc.Arbitrary<string> {
	const pads = [' '.repeat(column), ' '.repeat(column + 1)];
	if (column <= 4) pads.push('\t');
	if (line.text === '') return fc.constantFrom('', ' ', '\t', ...pads);
	const padded = fc.constantFrom(...pads).map((pad) => pad + line.text);
	return line.lazy ? fc.oneof(padded, fc.constant(line.text)) : padded;
}

const itemMarker = fc.constantFrom(
	'- ',
	'-\t',
	'-  ',
	'* ',
	'1. ',
	'1.\t',
	'2) ',
	'- [ ] ',
	'- [x]\t'
);

const spelledLines = (lines: fc.Arbitrary<string>[]): fc.Arbitrary<string[]> =>
	lines.length === 0 ? fc.constant([]) : fc.tuple(...lines);

const { container } = fc.letrec<{ body: DrawnLine[]; container: DrawnLine[] }>((tie) => ({
	// Blocks a blank line apart.
	body: fc
		.array(fc.oneof({ arbitrary: drawnParagraph, weight: 3 }, tie('container')), {
			minLength: 1,
			maxLength: 3
		})
		.map((blocks) =>
			blocks.flatMap((block, i) => (i === 0 ? block : [{ text: '', lazy: false }, ...block]))
		),
	container: fc.oneof(
		{ depthSize: 'small', maxDepth: 2 },
		tie('body').chain((body) =>
			spelledLines(body.map(quoteSpelling)).map((lines): DrawnLine[] =>
				lines.map((text, i) => ({ text, lazy: body[i].lazy }))
			)
		),
		fc
			.tuple(fc.constantFrom('', ' ', '   '), itemMarker, tie('body'))
			.chain(([indent, marker, body]) =>
				spelledLines(
					body.map((line, i) =>
						i === 0
							? fc.constant(indent + marker + line.text)
							: itemSpelling(line, indent.length + marker.length)
					)
				).map((lines): DrawnLine[] => lines.map((text, i) => ({ text, lazy: body[i].lazy })))
			)
	)
}));

/** Quotes and lists spelled every way GFM reads the same, a blank line apart. */
export const arbRespelledContainerDoc = withDrawnLineEnding(
	fc
		.array(container, { minLength: 1, maxLength: 3 })
		.map((blocks) =>
			blocks.map((lines) => lines.map((line) => line.text + '\n').join('')).join('\n')
		)
);

/** Blank runs, since one blank line separates and each later one is a block of its own; the
 *  whitespace-only lines are blank under GFM §2.1 and must survive verbatim. */
const blankLine = fc.constantFrom('\n', ' \n', '  \n', '\t\n', ' \t \n');
const blankRun = fc.array(blankLine, { maxLength: 4 }).map((lines) => lines.join(''));

// ── Recursive document ──────────────────────────────────────────────────────

const { block } = fc.letrec<{ block: string; body: string }>((tie) => ({
	// Container bodies hold runs too: strip-and-recurse means the inner parse sees the same
	// blank-line rule, and a container's rebuild has to reproduce the run's bytes.
	body: fc
		.array(fc.tuple(blankRun, tie('block')), { minLength: 1, maxLength: 2 })
		.map((parts) => parts.map(([run, inner], i) => (i === 0 ? inner : run + inner)).join('')),
	block: fc.oneof(
		{ depthSize: 'small', maxDepth: 3 },
		{ arbitrary: heading, weight: 3 },
		{ arbitrary: paragraph, weight: 4 },
		{ arbitrary: setextHeading, weight: 1 },
		{ arbitrary: fencedCode, weight: 2 },
		{ arbitrary: indentedCode, weight: 1 },
		{ arbitrary: thematicBreak, weight: 1 },
		{ arbitrary: linkRefDef, weight: 1 },
		{ arbitrary: table, weight: 2 },
		{
			arbitrary: tie('body').map((inner) =>
				inner
					.split('\n')
					.map((line, i, arr) => (i === arr.length - 1 && line === '' ? '' : '> ' + line))
					.join('\n')
			),
			weight: 2
		},
		{
			arbitrary: fc
				.tuple(
					fc.constantFrom('- ', '* ', '+ ', '1. ', '- [ ] ', '- [x] '),
					fc.boolean(),
					tie('body')
				)
				.map(([marker, tabbed, inner]) => {
					// A tab reaches column four, past a short marker's content column (GFM §2.2).
					const pad = tabbed
						? '\t' + ' '.repeat(Math.max(0, marker.length - 4))
						: ' '.repeat(marker.length);
					return inner
						.split('\n')
						.map((line, i, arr) =>
							i === arr.length - 1 && line === '' ? '' : (i === 0 ? marker : pad) + line
						)
						.join('\n');
				}),
			weight: 2
		}
	)
}));

const lfDoc = fc
	.array(fc.tuple(blankRun, block), { minLength: 1, maxLength: 8 })
	.map((parts) => parts.map(([run, b]) => run + b).join(''));

/** Valid-ish GFM source with bounded nesting depth (~3), emitted as a source string. */
export const arbGfmDoc = withDrawnLineEnding(lfDoc);

/** Every gap holds a blank line, as in a real document: without one, a split's kind change can
 *  pull the next block into the new half, a separate defect class that masks the blank-line rule. */
export const arbBlankSeparatedGfmDoc = withDrawnLineEnding(
	fc
		.array(fc.tuple(fc.array(blankLine, { minLength: 1, maxLength: 3 }), block), {
			minLength: 1,
			maxLength: 6
		})
		.map((parts) => parts.map(([run, b], i) => (i === 0 ? b : run.join('') + b)).join(''))
);

// ── Leading-indent dimension ────────────────────────────────────────────────

/** Indents either side of CommonMark's limit, where four columns (or a tab) turn a marker into
 *  indented code; every composed block otherwise sits at column 0. */
const blockIndent = fc.constantFrom('', ' ', '  ', '   ', '    ', '     ', '\t', ' \t', '   \t');

function indentBlock(source: string, indent: string, firstLineOnly: boolean): string {
	if (indent === '') return source;
	return source
		.split('\n')
		.map((line, i, all) => {
			// The trailing empty piece after a final newline is not a line.
			if (line === '' && i === all.length - 1) return line;
			if (firstLineOnly && i > 0) return line;
			return indent + line;
		})
		.join('\n');
}

/** `firstLineOnly` indents just the opener, leaving continuation lines at column 0, where a
 *  container's prefix re-derivation and a lazy continuation disagree about the indent. */
export const arbIndentedGfmDoc = withDrawnLineEnding(
	fc
		.array(fc.tuple(blankRun, blockIndent, block, fc.boolean()), {
			minLength: 1,
			maxLength: 6
		})
		.map((parts) =>
			parts
				.map(
					([trivia, indent, source, firstLineOnly]) =>
						trivia + indentBlock(source, indent, firstLineOnly)
				)
				.join('')
		)
);
