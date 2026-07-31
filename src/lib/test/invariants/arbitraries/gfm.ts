import fc from 'fast-check';

// Valid-ish GFM SOURCE strings, whose job is reaching the structured parser paths raw
// garbage rarely does. Structural validity is never required: round-trip is byte-preserving
// either way, so a malformed draw is signal, not a false failure.

// ── Leaf-block source fragments ─────────────────────────────────────────────

const inlineText = fc
	.array(
		fc.oneof(
			fc.constantFrom('word', 'lorem', 'x', '42'),
			fc.constantFrom('**b**', '_i_', '`c`', '~~s~~'),
			fc.constantFrom('[t](u)', '![a](i.png)', '&copy;', '\\*', '<br>'),
			fc.constantFrom('foo@bar.com', '<https://x.com>', 'www.x.com')
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

// headerDelta lets the header/delimiter cell counts disagree: GFM §4.10 makes
// the mismatch a paragraph, not a table, and round-trip must hold either way.
const table = fc
	.tuple(
		fc.integer({ min: 1, max: 3 }),
		fc.integer({ min: -1, max: 1 }),
		fc.array(fc.constantFrom('a', 'b', '1', 'x | y', ''), { minLength: 0, maxLength: 2 })
	)
	.map(([cols, headerDelta, bodyCells]) => {
		const headerCols = Math.max(1, cols + headerDelta);
		const header =
			'| ' + Array.from({ length: headerCols }, (_, i) => 'H' + i).join(' | ') + ' |\n';
		const delim = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |\n';
		const rows = bodyCells
			.map((cell) => '| ' + Array.from({ length: cols }, () => cell).join(' | ') + ' |\n')
			.join('');
		return header + delim + rows;
	});

const blankTrivia = fc.constantFrom('', '\n', '\n\n', '\n\n\n');

// ── Recursive document ──────────────────────────────────────────────────────

const { block } = fc.letrec<{ block: string }>((tie) => ({
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
			arbitrary: tie('block').map((inner) =>
				inner
					.split('\n')
					.map((line, i, arr) => (i === arr.length - 1 && line === '' ? '' : '> ' + line))
					.join('\n')
			),
			weight: 2
		},
		{
			arbitrary: fc
				.tuple(fc.constantFrom('- ', '* ', '+ ', '1. ', '- [ ] ', '- [x] '), tie('block'))
				.map(([marker, inner]) => {
					const pad = ' '.repeat(marker.length);
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
	.array(fc.tuple(blankTrivia, block), { minLength: 1, maxLength: 8 })
	.map((parts) => parts.map(([trivia, b]) => trivia + b).join(''));

/**
 * Valid-ish GFM source with bounded nesting depth (~3), emitted as a source STRING.
 *
 * The line ending is a document-level draw because "a CRLF document containing a
 * structured block" is otherwise unreachable by every lane at once — the hole two shipped
 * byte-corruption defects lived in. Mapped at the top: the container arms split on `'\n'`
 * internally, so rewriting after they compose is what keeps the result byte-exact.
 */
export const arbGfmDoc = fc
	.tuple(lfDoc, fc.boolean())
	.map(([source, crlf]) => (crlf ? source.replace(/\n/g, '\r\n') : source));

// ── Leading-indent dimension ────────────────────────────────────────────────

/**
 * Indents straddling the CommonMark block-indent boundary — up to three spaces a marker
 * still opens its block, at four the line is indented code, and a tab counts as four
 * columns. Every composed block sits at column 0, so that rule is otherwise unreachable.
 */
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

/**
 * GFM documents with a leading indent per block. `firstLineOnly` is its own dimension:
 * indenting only the opener leaves continuation lines at column 0, which is where a
 * container's prefix re-derivation and a lazy continuation disagree about the indent.
 */
export const arbIndentedGfmDoc = fc
	.array(fc.tuple(blankTrivia, blockIndent, block, fc.boolean()), {
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
	);
