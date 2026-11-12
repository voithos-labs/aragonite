// A link definition whose title has started and not closed, above lines the title runs on across,
// with one change that closes the title or takes away the line that ended it. An edit there has to
// read from the definition, several blocks above the change, down to where the title now closes.

import fc from 'fast-check';

export interface DocumentEdit {
	before: string;
	after: string;
}

export type Wrap = 'top' | 'quote' | 'item';

const CLOSER: Record<string, string> = { '"': '"', "'": "'", '(': ')' };

/** `lines` as a document: at the top level, behind a quote's markers, or as a list's first item. */
export function wrapped(lines: readonly string[], wrap: Wrap, eol: string): string {
	const all =
		wrap === 'top'
			? lines
			: wrap === 'quote'
				? [...lines.map((line) => (line === '' ? '>' : `> ${line}`)), '', 'after']
				: [
						...lines.map((line, i) => (i === 0 ? `- ${line}` : line === '' ? '' : `  ${line}`)),
						'z'
					];
	return all.join(eol) + eol;
}

// ── Named rows ───────────────────────────────────────────────────────────────

type Change = { take: number } | { put: number; line: string };

function row(wrap: Wrap, eol: string, lines: string[], change: Change): [string, DocumentEdit] {
	const now = [...lines];
	if ('take' in change) now.splice(change.take, 1);
	else now[change.put] = change.line;
	const what =
		'take' in change
			? `line ${change.take} taken`
			: `line ${change.put} now ${JSON.stringify(change.line)}`;
	const name = `${wrap}${eol === '\n' ? '' : ', CRLF'}, ${what}: ${lines.join(' | ')}`;
	return [name, { before: wrapped(lines, wrap, eol), after: wrapped(now, wrap, eol) }];
}

const TAIL = ['', 'last'];
const CODE_THEN_HEADING = ['[a]: /u', "    'code", '# h', 'text', "end'", ...TAIL];
const TWO_DEFINITIONS = ['[a]: /u', '    "code', '[b]: /v', '[b]: /v', 'end', ...TAIL];
const IN_PARENS = ['[a]: /u', '    (code', '[b]: /v', '[b]: /v', 'end', ...TAIL];

/** Changes that close a started title, or take away what ended it: each needs a window that
 *  reaches up to the definition and runs on to the title's end. */
export const WAITING_DEFINITION_ROWS: [string, DocumentEdit][] = [
	...(['\n', '\r\n'] as const).flatMap((eol) => [
		row('top', eol, CODE_THEN_HEADING, { take: 2 }),
		row('top', eol, CODE_THEN_HEADING, { put: 2, line: '    # h' }),
		row('quote', eol, CODE_THEN_HEADING, { put: 2, line: '    # h' }),
		row('top', eol, TWO_DEFINITIONS, { put: 4, line: 'end"' }),
		row('quote', eol, TWO_DEFINITIONS, { put: 4, line: 'end"' }),
		row('top', eol, TWO_DEFINITIONS, { put: 5, line: '"' }),
		row('quote', eol, TWO_DEFINITIONS, { put: 5, line: '"' }),
		row('top', eol, IN_PARENS, { put: 4, line: 'end)' }),
		row('quote', eol, IN_PARENS, { put: 5, line: ')' })
	]),
	row(
		'top',
		'\n',
		['[a]: /u', '    "code', '', '[b]: /v', '[c]: /w', '[c]: /w', '    code', 'end"', ...TAIL],
		{ take: 2 }
	),
	row(
		'top',
		'\n',
		['[a]: /u', '    "code', '[b]: /v', '[b]: /v', '[c]: /w', '# h', '[b]: /v', 'end"', ...TAIL],
		{ take: 5 }
	),
	row('top', '\n', ['[a]: /u', "    'code", '[b]: /v', '[b]: /v', '[b]: /v', 'end', ...TAIL], {
		put: 5,
		line: "end'"
	}),
	row(
		'quote',
		'\n',
		['[a]: /u', "    'code", '', '    code', '[c]: /w', '[b]: /v', "end'", ...TAIL],
		{ take: 2 }
	),
	row(
		'quote',
		'\n',
		['[a]: /u', '    "code', '[b]: /v', '[b]: /v', '[c]: /w', '[c]: /w', 'end', ...TAIL],
		{ put: 6, line: 'end"' }
	),
	// A list numbered from 2 and a table interrupt no paragraph, so a title runs on into them.
	// Miss-analysis: no row and no drawn line put a container under the title, so the window
	// inside a list or a table was never asked about a wait above it.
	...(['top', 'quote'] as const).flatMap((wrap) => [
		row(wrap, '\n', ['[a]: /u', '    "code', '2. two', '3. three', 'end', ...TAIL], {
			put: 4,
			line: 'end"'
		}),
		row(wrap, '\n', ['[a]: /u', '    "code', '2. two', '3. th"ree', '4. four"', ...TAIL], {
			put: 3,
			line: '3. three'
		}),
		row(wrap, '\n', ['[a]: /u', '"a | b', ':- | -', 'x | y', 'z | w', ...TAIL], {
			put: 4,
			line: 'z | w"'
		})
	])
];

// ── Drawn ────────────────────────────────────────────────────────────────────

const RUNS_ON = ['[b]: /v', '[b]: /v', '    code', 'text', '[c]: /w', '2. two', '3. three'];
const ENDS_A_TITLE = ['# h', '***', '', '- item', '> q', '```'];

/** A waiting definition and one change under it, biased to changes that close its title or take
 *  away the line that ended it: a change drawn blind almost never does either. */
export const arbWaitingDefinitionEdit: fc.Arbitrary<DocumentEdit> = fc
	.record({
		quote: fc.constantFrom('"', "'", '('),
		indented: fc.boolean(),
		above: fc.array(fc.constantFrom(...RUNS_ON), { maxLength: 2 }),
		end: fc.option(fc.constantFrom(...ENDS_A_TITLE), { freq: 3 }),
		below: fc.array(fc.constantFrom(...RUNS_ON), { maxLength: 3 }),
		closed: fc.boolean(),
		wrap: fc.constantFrom<Wrap>('top', 'top', 'quote', 'item'),
		eol: fc.constantFrom('\n', '\n', '\r\n'),
		edit: fc.constantFrom('take', 'take', 'demote', 'close', 'close', 'indent')
	})
	.map(({ quote, indented, above, end, below, closed, wrap, eol, edit }) => {
		const closing = `end${CLOSER[quote]}`;
		const lines = [
			'[a]: /u',
			indented ? `    ${quote}code` : `${quote}t`,
			...above,
			...(end === null ? [] : [end]),
			...below,
			closed && edit !== 'close' ? closing : 'end',
			...TAIL
		];
		const at = end === null ? -1 : 2 + above.length;
		const now = [...lines];
		if (edit === 'close') now[lines.length - 3] = closing;
		else if (at < 0) return null;
		else if (edit === 'take') now.splice(at, 1);
		else if (edit === 'demote') now[at] = now[at].replace(/^(# |- |> |```|\*)/, '') || 'x';
		else now[at] = `    ${now[at]}`;
		return { before: wrapped(lines, wrap, eol), after: wrapped(now, wrap, eol) };
	})
	.filter((edit): edit is DocumentEdit => edit !== null && edit.before !== edit.after);
