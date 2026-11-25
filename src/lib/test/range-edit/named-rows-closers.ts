// Named rows for the lines a removal keeps: a closing line the range leaves stands under what is
// left of its own container, above whatever followed it, and the line after the range still starts
// a line. Each row is a cut; Backspace and Delete leave the same bytes (law 4). The later rows are
// Delete's, whose caret lands at the text after the range, past an opening the removal kept, and a
// line break's, which lands there too where the range entered the block holding that text.

import type { NamedRow } from './named-rows';

type Caret = NonNullable<NamedRow['expect']['caret']>;

const cut = (name: string, source: string, out: string, caret?: Caret): NamedRow[] => {
	const expect = { source: out, ...(caret && { caret }) };
	return [
		{ name, source, gesture: 'cut', expect },
		{ name: `${name}, live`, source, mode: 'live', gesture: 'cut', expect }
	];
};

// Miss-analysis: no drawn fenced container held a block a range takes whole from its first byte
// (its bodies held paragraphs and `# head`), so no range left one from there with a block after it.
const CLOSING_LINE_ROWS: NamedRow[] = [
	...cut(
		'L4 a block taken whole out of an open details keeps the emptied line, its closing line above the heading after',
		'<details open>\n<summary>Sum</summary>\n\n⟦---\n\nbody\n\n</details>\n\npara⟧\n\n# h\n',
		'<details open>\n<summary>Sum</summary>\n\n\n</details>\n\n# h\n'
	),
	...cut(
		'L4 the same from the middle of the body keeps the closing line under the joined text',
		'<details open>\n<summary>Sum</summary>\n\n---\n\nbo⟦dy\n\n</details>\n\npara⟧\n\n# h\n',
		'<details open>\n<summary>Sum</summary>\n\n---\n\nbo\n</details>\n\n# h\n'
	),
	...cut(
		'L4 a tip in a note keeps its closing line before the note’s',
		'::::note\n:::tip\n⟦---\n\nbody\n:::\n\npara⟧\n::::\n',
		'::::note\n:::tip\n:::\n::::\n'
	),
	...cut(
		'L4 a details in a note keeps its closing line before the note’s',
		':::note\n<details open>\n<summary>Sum</summary>\n\n⟦---\n\nbody\n\n</details>\n\npara⟧\n:::\n\n# h\n',
		':::note\n<details open>\n<summary>Sum</summary>\n\n\n</details>\n:::\n\n# h\n'
	),
	...cut(
		'L4 a titled note emptied whole keeps its closing line and the blank line after it',
		':::note Title\n⟦***\n\nbody\n:::\n\npara⟧\n\n# h\n',
		':::note Title\n:::\n\n# h\n'
	),
	...cut(
		'L4 a note in a quote keeps its closing line behind the quote’s marker',
		'> :::note\n> ⟦***\n>\n> body\n> :::\n>\n> para⟧\n> more\n',
		'> :::note\n> :::\n> more\n'
	),
	...cut(
		'L4 in CRLF the closing line keeps the line ending of the line above it',
		'<details open>\r\n<summary>Sum</summary>\r\n\r\n⟦---\r\n\r\nbody\r\n\r\n</details>\r\n\r\npara⟧\r\n\r\n# h\r\n',
		'<details open>\r\n<summary>Sum</summary>\r\n\r\n\r\n</details>\r\n\r\n# h\r\n'
	),
	...cut(
		'L4 with mixed line endings every byte before the range stays',
		'::::note\r\n:::tip\n| a | b |\r\n|---|---|\n⟦| 1 | 2 |\r\n| 3 | 4 |\n:::\r\n::::\n\r\np⟧ara',
		'::::note\r\n:::tip\n| a | b |\r\n|---|---|\n:::\r\n::::\r\nara'
	),
	...cut(
		'L4 a block taken whole leaves no empty line where the range enters a fence below it',
		':::note\n⟦```\nx\n```\n~~~\ny⟧\n~~~\n:::\n\nafter\n',
		':::note\n~~~\n~~~\n:::\n\nafter\n'
	),
	...cut(
		'L4 a closed details, which a range out of its summary holds whole, still goes whole',
		'⟦<details>\n<summary>Sum</summary>\n\n***\n\nbody\n\n</details>\n\npara⟧\n\n# h\n',
		'\n# h\n'
	)
];

// Miss-analysis: no row started at a title row's end over a table, and none ended in a title row
// after a block the range took whole.
const LINE_ROWS: NamedRow[] = [
	...cut(
		'L4 from a title row’s end into a table’s middle row, the header and the rows below it stay',
		':::note T⟦\n| a | b |\n|---|---|\n| 1 | 2 |\n⟧| 3 | 4 |\n:::\n\npara\n',
		':::note T\n| a | b |\n|---|---|\n| 3 | 4 |\n:::\n\npara\n'
	),
	...cut(
		'L4 a range ending in a title row keeps that row’s line',
		'⟦<details>\n<summary>S</summary>\n\nx\n\n</details>\n\n:::note⟧\ntwo words\none\n\n:::\n',
		':::note\ntwo words\none\n\n:::\n'
	),
	...cut(
		'L4 and a titled one keeps its line, its title emptied',
		'⟦<details>\n<summary>S</summary>\n\nx\n\n</details>\n\n:::note Title⟧\ntwo words\n:::\n',
		':::note \ntwo words\n:::\n'
	)
];

// Miss-analysis: every range into a table's middle row started at the top level or in a note, so no
// kept header carried a quote's, an alert's or a footnote's markers.
const OPENING_ROWS: NamedRow[] = [
	...cut(
		'L4 a table entered below its header in a quote keeps that header behind one marker',
		'> a⟦bc\n>\n> | a | b |\n> |---|---|\n> | 1 | 2 |\n⟧> | 3 | 4 |\n\npara\n',
		'> a\n>\n> | a | b |\n> |---|---|\n> | 3 | 4 |\n\npara\n'
	),
	...cut(
		'L4 the same in a footnote keeps its header at the footnote’s indent',
		'[^1]: a⟦bc\n\n    | a | b |\n    |---|---|\n    | 1 | 2 |\n⟧    | 3 | 4 |\n\npara\n',
		'[^1]: a\n\n    | a | b |\n    |---|---|\n    | 3 | 4 |\n\npara\n'
	),
	...cut(
		'L4 and in an alert',
		'> [!NOTE]\n> a⟦bc\n>\n> | a | b |\n> |---|---|\n> | 1 | 2 |\n⟧> | 3 | 4 |\n\npara\n',
		'> [!NOTE]\n> a\n>\n> | a | b |\n> |---|---|\n> | 3 | 4 |\n\npara\n'
	)
];

// Miss-analysis: every row that left a container without joining text started in a block taken
// whole or in mid-line, so none started at a line's first byte in a block that stays.
const START_LINE_ROWS: NamedRow[] = [
	...cut(
		'L4 from a paragraph’s second line into a container right below, that line stays, emptied',
		'x\n⟦body\n:::tip\nin⟧ner\n:::\n\n# h\n',
		'x\n\n:::tip\nner\n:::\n\n# h\n',
		{ at: 2, holds: 'boundary', parent: [] }
	),
	...cut(
		'L4 from a code line’s start out of its block, that line stays, emptied',
		'```\none\n⟦two\n```\n\npa⟧ra\n',
		'```\none\n\n```\nra\n',
		{ at: 8, holds: 'text' }
	),
	...cut(
		'L4 a paragraph emptied from its first byte keeps its line in the note the range leaves',
		':::note\n⟦body\n:::\n\n```\nco⟧de\n```\n',
		':::note\n\n:::\n\n```\nde\n```\n',
		{ at: 8, holds: 'text' }
	)
];

/** A container `wrap` around `above` and the blocks a range takes whole to its end, with `block`
 *  after it: the opening line's markers, the next lines', and the path of the container. */
const LEFT_WRAPS = {
	'a quote': { open: '> ', next: '> ', parent: [1], eol: '\n' },
	'an item': { open: '- ', next: '  ', parent: [1, 0], eol: '\n' },
	'a quote in an item': { open: '- > ', next: '  > ', parent: [1, 0, 0], eol: '\n' },
	'an alert': { open: '> [!NOTE]\n> ', next: '> ', parent: [1], eol: '\n' },
	'a footnote': { open: '[^1]: ', next: '    ', parent: [1], eol: '\n' },
	'a quote in CRLF': { open: '> ', next: '> ', parent: [1], eol: '\r\n' }
};
const LEFT_BLOCKS = {
	'a fence': ['```', 'last', '```'],
	'a math block': ['$$', 'm', '$$'],
	'a rule': ['***'],
	'a table': ['| a |', '|---|', '| 1 |'],
	'a tip': [':::tip', 'body', ':::'],
	'a heading': ['# h']
};

// Miss-analysis: every row that took a container's last blocks from a block taken whole started at
// the top level or emptied the container, so none kept a block above the emptied marker line.
const LEFT_LINE_ROWS: NamedRow[] = Object.entries(LEFT_WRAPS).flatMap(([wrap, w]) =>
	Object.entries(LEFT_BLOCKS).flatMap(([name, lines]) => {
		const [lead, block] = [`intro${w.eol}${w.eol}${w.open}above${w.eol}`, lines.join(w.eol)];
		const taken = `⟦# text${w.eol}${w.next}below⟧`;
		return cut(
			`L4 out of ${wrap} from a block taken whole, its line goes, above ${name}`,
			`${lead}${w.next}${taken}${w.eol}${w.eol}${block}${w.eol}`,
			`${lead}${w.eol}${block}${w.eol}`,
			{ at: lead.length, holds: 'boundary', parent: w.parent }
		);
	})
);

// What the rows above leave as it was: a start in a paragraph, a container taken whole or emptied.
const LEFT_LINE_KEPT_ROWS: NamedRow[] = [
	...cut(
		'L4 out of a quote from a paragraph’s first byte, its emptied line stays',
		'intro\n\n> above\n>\n> ⟦para\n> # h2⟧\n\n```\nlast\n```\n',
		'intro\n\n> above\n>\n> \n\n```\nlast\n```\n',
		{ at: 19, holds: 'text' }
	),
	...cut(
		'L4 a quote the range empties keeps its line',
		'intro\n\n> ⟦# text\n> below⟧\n\n```\nlast\n```\n',
		'intro\n\n> \n\n```\nlast\n```\n',
		{ at: 9, holds: 'text' }
	),
	...cut(
		'L4 a quote the range takes whole goes whole',
		'intro\n\n⟦> above\n> # text\n> below⟧\n\n```\nlast\n```\n',
		'intro\n\n```\nlast\n```\n',
		{ at: 7, holds: 'boundary', parent: [] }
	),
	// Miss-analysis: every row above had a blank line or the document's end under the range, so none
	// met a block right below, whose first byte took the caret once the line went.
	...cut(
		'L4 out of an item with the next item right below, the start’s emptied line stays',
		'- above\n  ⟦# text\n  below⟧\n- next\n',
		'- above\n  \n- next\n',
		{ at: 10, holds: 'boundary', parent: [0, 0] }
	),
	// Miss-analysis: every row above ended its container, so none ended at a line's end inside a
	// quote that goes on, where the line going is the range's own container's, not one it left.
	...cut(
		'L4 to a line’s end in a quote that goes on, the start’s emptied line stays',
		'> above\n> ⟦# text\n> below⟧\n>\n> more\n',
		'> above\n> \n>\n> more\n',
		{ at: 12, holds: 'text' }
	),
	// Miss-analysis: every row that took the start's line stood its block right under the one above,
	// so none had a blank line of the container over it, where the line going moved a typed key out.
	...cut(
		'L4 out of a quote from a block under a blank line of the quote, its emptied line stays',
		'intro\n\n> above\n>\n> ⟦# text\n> below⟧\n\n# h\n',
		'intro\n\n> above\n>\n> \n\n# h\n',
		{ at: 19, holds: 'text' }
	),
	...cut(
		'L4 out of an item from a block under a blank line of the item, its emptied line stays',
		'intro\n\n- above\n\n  ⟦# text\n  below⟧\n\n# h\n',
		'intro\n\n- above\n\n  \n\n# h\n',
		{ at: 18, holds: 'text' }
	),
	...cut(
		'L4 the same in CRLF',
		'intro\r\n\r\n> above\r\n>\r\n> ⟦# text\r\n> below⟧\r\n\r\n# h\r\n',
		'intro\r\n\r\n> above\r\n>\r\n> \r\n\r\n# h\r\n',
		{ at: 23, holds: 'text' }
	)
];

// Miss-analysis: every drop row cut a range whose bytes before its start stayed, so none dropped
// one at its own start where the cut took the start's line, and the drop point named later bytes.
const LEFT_LINE_DROP_ROWS: NamedRow[] = (['source', 'live'] as const).map((mode) => ({
	name: `L6 a range whose start line goes, dropped at its own start, changes nothing, ${mode}`,
	source: '> above\n> ⟦# text\n> below⟧\n\nlast\n',
	mode,
	gesture: { drop: 10, copy: false },
	expect: { source: '> above\n> # text\n> below\n\nlast\n' }
}));

/** Delete's rows in both modes, and a composition's where `composes` (a range ending in text). */
const deleted = (name: string, source: string, out: string, caret: Caret, composes = false) =>
	(composes ? (['delete', 'compose'] as const) : (['delete'] as const)).flatMap((gesture) =>
		(['source', 'live'] as const).map((mode): NamedRow => ({
			name: `${name}, ${gesture === 'compose' ? 'a composition' : 'Delete'}, ${mode}`,
			source,
			mode,
			gesture,
			expect: { source: out, caret }
		}))
	);

// Miss-analysis: the closing-line rows emptied a fenced container at the top level only, so none
// left a quote's emptied line inside it, under its title row.
const LEFT_TITLE_ROWS: NamedRow[] = [
	...cut(
		'L4 a note in a quote emptied from its first block keeps no emptied line under its title row',
		'> :::note\n> ⟦***\n>\n> body\n> :::\n\npara⟧\n\n# h\n',
		'> :::note\n> :::\n\n# h\n',
		{ at: 10, holds: 'boundary', parent: [0, 0] }
	),
	// A landing never rests on syntax: past the heading's `# ` in source mode too.
	...deleted(
		'L8 the same, Delete lands at the text after',
		'> :::note\n> ⟦***\n>\n> body\n> :::\n\npara⟧\n\n# h\n',
		'> :::note\n> :::\n\n# h\n',
		{ at: 19, holds: 'text' }
	)
];

// Miss-analysis: no row ran Delete over a block taken whole into a fenced container's body, so none
// saw the caret stop on the opening line the removal kept, short of the text after the range.
const TEXT_AFTER_ROWS: NamedRow[] = [
	...deleted(
		'L8 a block taken whole out of a note into a tip’s body lands at the tip’s text',
		':::note\n⟦***\n\nbody\n:::\n\n:::tip\nin⟧ner\nmore\n:::\n\n# h\n',
		':::note\n:::\n\n:::tip\nner\nmore\n:::\n\n# h\n',
		{ at: 20, holds: 'text' },
		true
	),
	...deleted(
		'L8 the same from the document’s first block',
		'⟦***\n\nbody\n\n:::tip\nin⟧ner\nmore\n:::\n\n# h\n',
		':::tip\nner\nmore\n:::\n\n# h\n',
		{ at: 7, holds: 'text' }
	),
	...deleted(
		'L8 into a titled tip’s body, past its title',
		':::note\n⟦***\n\nbody\n:::\n\n:::tip Title\nin⟧ner\n:::\n\n# h\n',
		':::note\n:::\n\n:::tip Title\nner\n:::\n\n# h\n',
		{ at: 26, holds: 'text' }
	),
	...deleted(
		'L8 into a tip’s title, at what is left of it',
		':::note\n⟦***\n\nbody\n:::\n\n:::tip Ti⟧tle\ninner\n:::\n\n# h\n',
		':::note\n:::\n\n:::tip tle\ninner\n:::\n\n# h\n',
		{ at: 20, holds: 'text' }
	),
	...deleted(
		'L8 to a tip’s title end, at its body’s text',
		':::note\n⟦***\n\nbody\n:::\n\n:::tip⟧\ninner\n:::\n\n# h\n',
		':::note\n:::\n\n:::tip\ninner\n:::\n\n# h\n',
		{ at: 20, holds: 'text' }
	),
	...deleted(
		'L8 into an item in a tip, past the item’s marker',
		':::note\n⟦***\n\nbody\n:::\n\n:::tip\n- in⟧ner\n:::\n\n# h\n',
		':::note\n:::\n\n:::tip\n- ner\n:::\n\n# h\n',
		{ at: 22, holds: 'text' }
	),
	...deleted(
		'L8 into a quote in a tip, past the quote’s marker',
		':::note\n⟦***\n\nbody\n:::\n\n:::tip\n> in⟧ner\n:::\n\n# h\n',
		':::note\n:::\n\n:::tip\n> ner\n:::\n\n# h\n',
		{ at: 22, holds: 'text' }
	),
	...deleted(
		'L8 past a rule in a tip it took whole',
		':::note\n⟦***\n\nbody\n:::\n\n:::tip\n***\n\nin⟧ner\n:::\n\n# h\n',
		':::note\n:::\n\n:::tip\nner\n:::\n\n# h\n',
		{ at: 20, holds: 'text' }
	),
	...deleted(
		'L8 into an open details’ body, past its summary',
		':::note\n⟦***\n\nbody\n:::\n\n<details open>\n<summary>Sum</summary>\n\nin⟧ner\n\n</details>\n\n# h\n',
		':::note\n:::\n\n<details open>\n<summary>Sum</summary>\nner\n\n</details>\n\n# h\n',
		{ at: 51, holds: 'text' }
	),
	...deleted(
		'L8 a tip whose body the range empties holds the caret where its blocks were',
		':::note\n⟦***\n\nbody\n:::\n\n:::tip\ninner⟧\n:::\n\n# h\n',
		':::note\n:::\n\n:::tip\n:::\n\n# h\n',
		{ at: 20, holds: 'boundary', parent: [1] }
	),
	// A landing never rests on syntax: an untitled row is all name, so Delete goes on into the body.
	...deleted(
		'L8 a range that stops before a tip it never entered lands at the tip’s first text',
		':::note\n⟦***\n\nbody\n:::\n\npara⟧\n\n:::tip\ninner\n:::\n\n# h\n',
		':::note\n:::\n\n:::tip\ninner\n:::\n\n# h\n',
		{ at: 20, holds: 'text' }
	),
	// Miss-analysis: every row above left the caret on syntax, none on a line the removal emptied.
	...deleted(
		'L8 a quote the range only empties keeps the caret on its emptied line',
		'> ⟦```\n> code\n> ```\n>\n> body\n\n:::tip Ti⟧tle\ninner\n:::\n\n# h\n',
		'> \n\n:::tip tle\ninner\n:::\n\n# h\n',
		{ at: 2, holds: 'text' },
		true
	)
];

// Miss-analysis: every range the rows entered crossed one opening, so none entered a tip inside a
// note or a code block inside a tip, where the inner opening went.
const ENTERED_ROWS: NamedRow[] = [
	...cut(
		'L4 a range entering a tip inside a note keeps both openings',
		':::note\n⟦***\n\nbody\n:::\n\n::::note\n:::tip\nin⟧ner\n:::\n::::\n\n# h\n',
		':::note\n:::\n\n::::note\n:::tip\nner\n:::\n::::\n\n# h\n'
	),
	...cut(
		'L4 a range entering a code block inside a tip keeps the fence’s opening line',
		':::note\n⟦***\n\nbody\n:::\n\n:::tip\n```\nco⟧de\n```\n:::\n\n# h\n',
		':::note\n:::\n\n:::tip\n```\nde\n```\n:::\n\n# h\n'
	),
	...deleted(
		'L8 two openings entered, Delete lands at the inner one’s text',
		':::note\n⟦***\n\nbody\n:::\n\n::::note\n:::tip\nin⟧ner\n:::\n::::\n\n# h\n',
		':::note\n:::\n\n::::note\n:::tip\nner\n:::\n::::\n\n# h\n',
		{ at: 29, holds: 'text' }
	),
	...deleted(
		'L8 a code block entered inside a tip, Delete lands at its text',
		':::note\n⟦***\n\nbody\n:::\n\n:::tip\n```\nco⟧de\n```\n:::\n\n# h\n',
		':::note\n:::\n\n:::tip\n```\nde\n```\n:::\n\n# h\n',
		{ at: 24, holds: 'text' }
	)
];

// Miss-analysis: the rows above entered two openings at most, both `:::` and from inside a note, so
// none started at the document's start, crossed another kind, or took the end's block whole.
const MIXED_ROWS: NamedRow[] = [
	...deleted(
		'L8 two openings entered from the document’s first block',
		'⟦***\n\nbody\n\n::::note\n:::tip\nin⟧ner\n:::\n::::\n\n# h\n',
		'::::note\n:::tip\nner\n:::\n::::\n\n# h\n',
		{ at: 16, holds: 'text' }
	),
	...deleted(
		'L8 three openings entered',
		':::note\n⟦***\n\nbody\n:::\n\n:::::note\n::::note\n:::tip\nin⟧ner\n:::\n::::\n:::::\n\n# h\n',
		':::note\n:::\n\n:::::note\n::::note\n:::tip\nner\n:::\n::::\n:::::\n\n# h\n',
		{ at: 39, holds: 'text' }
	),
	...deleted(
		'L8 a code block in a tip in a details in a note keeps all four openings',
		':::note\n⟦***\n\nbody\n:::\n\n::::note\n<details open>\n<summary>Sum</summary>\n\n:::tip\n```\nco⟧de\n```\n:::\n\n</details>\n::::\n\n# h\n',
		':::note\n:::\n\n::::note\n<details open>\n<summary>Sum</summary>\n:::tip\n```\nde\n```\n:::\n\n</details>\n::::\n\n# h\n',
		{ at: 71, holds: 'text' }
	),
	...deleted(
		'L8 a tip in a quote, past the quote’s marker',
		'⟦***\n\nbody\n\n> :::tip\n> in⟧ner\n> :::\n\n# h\n',
		'> :::tip\n> ner\n> :::\n\n# h\n',
		{ at: 11, holds: 'text' }
	),
	...deleted(
		'L8 a tip in an item, past the item’s indent',
		'⟦***\n\nbody\n\n- :::tip\n  in⟧ner\n  :::\n\n# h\n',
		'- :::tip\n  ner\n  :::\n\n# h\n',
		{ at: 11, holds: 'text' }
	),
	...deleted(
		'L8 a block taken whole between two openings goes',
		':::note\n⟦***\n\nbody\n:::\n\n::::note\n***\n\n:::tip\nin⟧ner\n:::\n::::\n\n# h\n',
		':::note\n:::\n\n::::note\n:::tip\nner\n:::\n::::\n\n# h\n',
		{ at: 29, holds: 'text' }
	),
	...deleted(
		'L8 a tip whose only block the range takes holds the caret at its closing line',
		':::note\n⟦***\n\nbody\n:::\n\n:::tip\n***⟧\n:::\n\n# h\n',
		':::note\n:::\n\n:::tip\n:::\n\n# h\n',
		{ at: 20, holds: 'boundary', parent: [1] }
	),
	...deleted(
		'L8 a block taken whole under a blank line in a note the range leaves',
		':::note\nx\n\n⟦***\n\nbody\n:::\n\n:::tip\nin⟧ner\n:::\n\n# h\n',
		':::note\nx\n\n:::\n\n:::tip\nner\n:::\n\n# h\n',
		{ at: 23, holds: 'text' }
	),
	{
		name: 'L8 a bold run the range empties goes, and Delete lands at the text after it, live',
		source: '⟦***\n\nbody\n\n:::tip\n**in⟧**ner\n:::\n\n# h\n',
		mode: 'live',
		gesture: 'delete',
		expect: { source: ':::tip\nner\n:::\n\n# h\n', caret: { at: 7, holds: 'text' } }
	}
];

// Miss-analysis: only a mounted commit checks for a lone `\r`, and no mounted test mixed endings; the
// laws read the end line to its text, never its line ending, and the byte map put a `\n` on its `\r`.
const MIXED_ENDING_ROWS: NamedRow[] = [
	...cut(
		'L4 with mixed line endings a closing line kept under joined text leaves no lone CR',
		':::note\r\nbo⟦dy\r\n:::\n\r\npa⟧ra\n',
		':::note\r\nbora\r\n:::\n'
	),
	...cut(
		'L4 with mixed line endings a lazy line joined two quotes deep keeps its own line ending',
		'> > one⟦\r\n⟧two\n',
		'> > onetwo\n'
	),
	...cut(
		'L4 with mixed line endings a lazy line joined in a list in a list keeps its own line ending',
		'- 1. one⟦\r\n⟧two\n- three\n',
		'- 1. onetwo\n- three\n'
	)
];

// Miss-analysis: every range the rows drew into a block that runs on ended mid-line, so none ended at
// a line's end, where whole lines took that line and its markers stood again before the next line's.
const LINE_END_ROWS: NamedRow[] = [
	...cut(
		'L4 a range ending at a code line’s end in a quote leaves the closing fence behind one marker',
		'⟦***\n\nbody\n\n> ```\n> code⟧\n> ```\n',
		'> ```\n> ```\n'
	),
	...cut(
		'L4 the same at a quote line’s end in a note',
		'⟦***\n\nbody\n\n:::note\n> inner⟧\n> more\n:::\n',
		':::note\n> more\n:::\n'
	),
	...cut(
		'L4 in an item the code line after keeps one indent',
		'⟦***\n\nbody\n\n- ```\n  code⟧\n  more\n  ```\n',
		'- ```\n  more\n  ```\n'
	),
	...cut(
		'L4 in a footnote the line after keeps one indent',
		'⟦***\n\nbody\n\n[^1]: :::tip\n    inner⟧\n    more\n    :::\n',
		'[^1]: :::tip\n    more\n    :::\n'
	),
	...cut(
		'L4 in a quote in an item the closing line keeps both markers once',
		'⟦***\n\nbody\n\n- > :::tip\n  > ***⟧\n  > :::\n',
		'- > :::tip\n  > :::\n'
	),
	...cut(
		'L4 two quotes deep',
		'⟦***\n\nbody\n\n> > ```\n> > code⟧\n> > ```\n',
		'> > ```\n> > ```\n'
	),
	...cut(
		'L4 in CRLF',
		'⟦***\r\n\r\nbody\r\n\r\n> ```\r\n> code⟧\r\n> ```\r\n',
		'> ```\r\n> ```\r\n'
	),
	...cut(
		'L4 where the line after is the document’s last',
		'⟦***\n\nbody\n\n> ```\n> code⟧\n> ```',
		'> ```\n> ```'
	),
	...cut(
		'L4 from a quote the range starts in, the line after takes that quote’s marker back',
		'> x\n>\n> ⟦***\n> > ```\n> > code⟧\n> > ```\n',
		'> x\n>\n> \n> > ```\n> > ```\n'
	),
	...cut(
		'L4 an HTML block entered from a note in a quote keeps the line after behind one marker',
		'> :::note\n> ⟦***\n>\n> body\n> :::\n>\n> <div>\n> b⟧\n> c\n> </div>\n',
		'> :::note\n> :::\n> c\n> </div>\n'
	),
	...cut(
		'L4 a blank code line right after the range stays',
		'⟦***\n\nbody\n\n```\ncode⟧\n\nmore\n```\n',
		'```\n\nmore\n```\n'
	),
	...deleted(
		'L8 a range ending at a code line’s end in a quote lands at the next line’s text',
		'⟦***\n\nbody\n\n> ```\n> code⟧\n> more\n> ```\n',
		'> ```\n> more\n> ```\n',
		{ at: 8, holds: 'text' },
		true
	),
	...deleted(
		'L8 the same at a quote line’s end in a note',
		'⟦***\n\nbody\n\n:::note\n> inner⟧\n> more\n:::\n',
		':::note\n> more\n:::\n',
		{ at: 10, holds: 'text' }
	),
	...deleted(
		'L8 in an item, past the code line’s indent',
		'⟦***\n\nbody\n\n- ```\n  code⟧\n  more\n  ```\n',
		'- ```\n  more\n  ```\n',
		{ at: 8, holds: 'text' }
	),
	...deleted(
		'L8 a blank code line after the range holds the caret',
		'⟦***\n\nbody\n\n:::tip\n```\ncode⟧\n\nmore\n```\n:::\n',
		':::tip\n```\n\nmore\n```\n:::\n',
		{ at: 11, holds: 'text' }
	),
	...deleted(
		'L8 the same in CRLF, before the empty line’s pair',
		'⟦***\r\n\r\nbody\r\n\r\n:::tip\r\n```\r\ncode⟧\r\n\r\nmore\r\n```\r\n:::\r\n',
		':::tip\r\n```\r\n\r\nmore\r\n```\r\n:::\r\n',
		{ at: 13, holds: 'text' }
	),
	// Miss-analysis: every row whose text after slid up to the caret started outside the container
	// holding it, so none met the caret's block holding the text after, behind its indent.
	...deleted(
		'L8 from inside a note, the lines under a nested item’s first line, past their indent',
		':::note\n⟦***\n\nbody\n\n- - inner⟧\n    more\n:::\n\n# h\n',
		':::note\n    more\n:::\n\n# h\n',
		{ at: 12, holds: 'text' }
	),
	...deleted(
		'L8 the same under one item',
		':::note\n⟦***\n\nbody\n\n- inner⟧\n  more\n:::\n\n# h\n',
		':::note\n  more\n:::\n\n# h\n',
		{ at: 10, holds: 'text' }
	),
	...deleted(
		'L8 an HTML block entered from a note in a quote, at its next line’s text',
		'> :::note\n> ⟦***\n>\n> body\n> :::\n>\n> <div>\n> b⟧\n> c\n> </div>\n',
		'> :::note\n> :::\n> c\n> </div>\n',
		{ at: 18, holds: 'text' }
	)
];

/** A line break's rows in both modes: Enter and Shift+Enter over the range run at this place. */
const broken = (name: string, source: string, out: string, caret: Caret) =>
	(['source', 'live'] as const).map((mode): NamedRow => ({
		name: `${name}, a line break, ${mode}`,
		source,
		mode,
		gesture: 'place',
		expect: { source: out, caret }
	}));

/** A composition's rows in both modes. */
const composed = (name: string, source: string, out: string, caret: Caret) =>
	(['source', 'live'] as const).map((mode): NamedRow => ({
		name: `${name}, a composition, ${mode}`,
		source,
		mode,
		gesture: 'compose',
		expect: { source: out, caret }
	}));

// Miss-analysis: every composition row ended inside a leaf's text, so none ended at a row's or a
// paragraph's end, where pairing a composition with Delete joined the block after.
const COMPOSITION_ROWS: NamedRow[] = [
	...composed(
		'L8 a range ending at a table row’s end lands where a typed key does, not in the next row',
		':::note\n⟦***\n\nbody\n:::\n\n| a | b |\n|---|---|\n| 1 | 2 |⟧\n| 3 | 4 |\n\n# h\n',
		':::note\n:::\n\n| a | b |\n|---|---|\n| 3 | 4 |\n\n# h\n',
		{ at: 8, holds: 'boundary', parent: [0] }
	),
	...composed(
		'L8 the same at a paragraph’s end before a heading',
		':::note\n⟦***\n\nbody\n:::\n\npara⟧\n\n# h\n',
		':::note\n:::\n\n# h\n',
		{ at: 8, holds: 'boundary', parent: [0] }
	)
];

// Miss-analysis: the rows stated Delete's caret alone, and a line break's removal landed as
// Backspace's, at the block before the range, where Enter then pressed on a kept opening line.
const LINE_BREAK_ROWS: NamedRow[] = [
	...broken(
		'L8 two openings entered from the document’s first block, the break goes before the text after',
		'⟦***\n\nbody\n\n::::note\n:::tip\nin⟧ner\n:::\n::::\n\n# h\n',
		'::::note\n:::tip\nner\n:::\n::::\n\n# h\n',
		{ at: 16, holds: 'text' }
	),
	...broken(
		'L8 a tip in a note entered from a note',
		':::note\n⟦***\n\nbody\n:::\n\n::::note\n:::tip\nin⟧ner\n:::\n::::\n\n# h\n',
		':::note\n:::\n\n::::note\n:::tip\nner\n:::\n::::\n\n# h\n',
		{ at: 29, holds: 'text' }
	),
	...broken(
		'L8 an open details entered inside a note',
		'⟦***\n\nbody\n\n:::note\n<details open>\n<summary>Sum</summary>\n\nin⟧ner\nmore\n\n</details>\n:::\n',
		':::note\n<details open>\n<summary>Sum</summary>\nner\nmore\n\n</details>\n:::\n',
		{ at: 46, holds: 'text' }
	),
	...broken(
		'L8 an item’s first line taken in a note, past the indent of the line after',
		'⟦***\n\nbody\n\n:::note\n- inner⟧\n  more\n:::\n',
		':::note\n  more\n:::\n',
		{ at: 10, holds: 'text' }
	),
	...broken(
		'L8 the same in an open details, in CRLF',
		'⟦***\r\n\r\nbody\r\n\r\n<details open>\r\n<summary>Sum</summary>\r\n\r\n- inner⟧\r\n  more\r\n\r\n</details>\r\n',
		'<details open>\r\n<summary>Sum</summary>\r\n  more\r\n\r\n</details>\r\n',
		{ at: 42, holds: 'text' }
	),
	...broken(
		'L8 a tip entered to its first paragraph’s end, nothing before the range, breaks the line it emptied',
		'⟦***\n\nbody\n\n:::tip\ninner⟧\n\nmore\n:::\n',
		':::tip\n\n\nmore\n:::\n',
		{ at: 8, holds: 'text' }
	),
	...broken(
		'L8 from inside a note, an item’s first line taken, past the indent of the line after',
		':::note\n⟦***\n\nbody\n\n- inner⟧\n  more\n:::\n\n# h\n',
		':::note\n  more\n:::\n\n# h\n',
		{ at: 10, holds: 'text' }
	),
	...broken(
		'L8 a range ending at a block’s end breaks in an empty paragraph where it was',
		'first\n\n⟦***\n\n# end⟧\n\n> quote\n',
		'first\n\n\n> quote\n',
		{ at: 7, holds: 'text' }
	),
	...broken(
		'L8 the same before a code block',
		'first\n\n⟦***\n\n# end⟧\n\n```\ncode\n```\n',
		'first\n\n\n```\ncode\n```\n',
		{ at: 7, holds: 'text' }
	),
	...broken(
		'L8 a range ending at a paragraph’s end breaks on the line it emptied',
		'first\n\n⟦***\n\npara⟧\n\n> quote\n',
		'first\n\n\n> quote\n',
		{ at: 7, holds: 'text' }
	),
	...broken(
		'L8 nothing before the range, above a tip’s opening line, the same',
		'⟦***\n\n# end⟧\n\n:::tip\nbody\n:::\n',
		'\n:::tip\nbody\n:::\n',
		{ at: 0, holds: 'text' }
	),
	...broken(
		'L8 at the document’s start the line the range emptied takes the break, not the tip’s',
		'⟦***\n\npara⟧\n\n:::tip\nbody\n:::\n',
		'\n:::tip\nbody\n:::\n',
		{ at: 0, holds: 'text' }
	),
	...broken(
		'L8 a note entered to its first paragraph’s end breaks the line it emptied, above the tip',
		'⟦***\n\nbody\n\n::::note\ninner⟧\n\n:::tip\nmore\n:::\n::::\n',
		'::::note\n\n\n:::tip\nmore\n:::\n::::\n',
		{ at: 10, holds: 'text' }
	),
	...broken(
		'L8 a title the range ends in takes it before its rest, where the row runs its own Enter',
		'⟦***\n\nbody\n\n:::tip Ti⟧tle\ninner\n:::\n',
		':::tip tle\ninner\n:::\n',
		{ at: 7, holds: 'text' }
	),
	{
		name: 'L8 any other command key’s removal still lands at the end of the block before',
		source: 'first\n\n⟦***\n\nbody\n\n::::note\n:::tip\nin⟧ner\n:::\n::::\n',
		gesture: 'command',
		expect: { caret: { at: 5, holds: 'text' } }
	}
];

/** Backspace's rows in both modes. */
const backspaced = (name: string, source: string, out: string, caret: Caret) =>
	(['source', 'live'] as const).map((mode): NamedRow => ({
		name: `${name}, Backspace, ${mode}`,
		source,
		mode,
		gesture: 'backspace',
		expect: { source: out, caret }
	}));

// Miss-analysis: every row from a block taken whole to a paragraph's end pinned the bytes the
// removal gave, and none set them beside the same range from a paragraph, so the emptied line went.
const EMPTIED_LINE_ROWS: NamedRow[] = [
	...backspaced(
		'L4 a paragraph the range empties keeps its line, which holds the caret',
		'first\n\n⟦***\n\npara⟧\n\nnext\n',
		'first\n\n\nnext\n',
		{ at: 7, holds: 'text' }
	),
	...backspaced(
		'L4 right under a paragraph too, the emptied line under a blank line',
		'above\n⟦***\n\npara⟧\n\nnext\n',
		'above\n\n\nnext\n',
		{ at: 7, holds: 'text' }
	),
	...backspaced(
		'L4 at the document’s end the emptied line is a place of its own',
		'above\n⟦***\n\npara⟧\n',
		'above\n\n',
		{ at: 6, holds: 'boundary', parent: [] }
	),
	...backspaced(
		'L4 an item emptied from its first block stays as an empty bullet',
		'- a\n- ⟦***\n\n  para⟧\n- b\n',
		'- a\n- \n- b\n',
		{ at: 6, holds: 'text' }
	),
	...backspaced(
		'L4 in a quote under a blank line of the quote the emptied line stays',
		'> above\n>\n> ⟦***\n>\n> body⟧\n\nlast\n',
		'> above\n>\n> \n\nlast\n',
		{ at: 12, holds: 'text' }
	),
	...cut(
		'L4 a callout emptied from its first block keeps no line, which it would read as its own',
		':::note\n⟦***\n\nbody⟧\n:::\n',
		':::note\n:::\n'
	),
	...backspaced(
		'L4 nor right under a block in a callout, to its end',
		':::note\nabove\n⟦***\n\nbody⟧\n:::\n',
		':::note\nabove\n:::\n',
		{ at: 13, holds: 'text' }
	),
	...backspaced(
		'L4 nor at the end of a callout’s body under a blank line, which reads as no paragraph',
		':::note\nabove\n\n⟦***\n\nbody⟧\n:::\n',
		':::note\nabove\n\n:::\n',
		{ at: 13, holds: 'text' }
	),
	...backspaced(
		'L4 a callout the range enters keeps the line of the paragraph it empties',
		'first\n\n⟦***\n\nbody\n\n:::tip\ninner⟧\n\nmore\n:::\n',
		'first\n\n:::tip\n\n\nmore\n:::\n',
		{ at: 15, holds: 'text' }
	),
	...backspaced(
		'L4 nor at the end of a details’ body under a blank line',
		'<details open>\n<summary>S</summary>\n\nabove\n\n⟦***\n\nbody⟧\n\n</details>\n',
		'<details open>\n<summary>S</summary>\n\nabove\n\n</details>\n',
		{ at: 42, holds: 'text' }
	),
	// Miss-analysis: the tidy asked whether the line under the blank was blank behind the emptied
	// line's markers trimmed, so an item's indent passed for a top-level blank and the line went.
	...cut(
		'L4 two paragraphs emptied in a footnote keep the blank line the footnote ends on',
		'[^1]: above\n\n    ⟦zero\n\n    body⟧\n\nlast\n',
		'[^1]: above\n\n    \n\nlast\n'
	),
	...cut('L4 and in an item', '- above\n\n  ⟦zero\n\n  below⟧\n\nlast\n', '- above\n\n  \n\nlast\n')
];

// Miss-analysis: every row's first block stood at the document's start, so none took one under a
// blank line or an opening row, where its blank line stayed above the opening and caught the caret.
const BARE_START_ROWS: NamedRow[] = [
	...cut(
		'L4 a block taken whole under a blank line leaves one blank line above the tip the range enters',
		'x\n\n⟦***\n\nbody\n\n:::tip\nin⟧ner\nmore\n:::\n\n# h\n',
		'x\n\n:::tip\nner\nmore\n:::\n\n# h\n'
	),
	...deleted(
		'L8 a block taken whole under a blank line, Delete lands at the tip’s text',
		'x\n\n⟦***\n\nbody\n\n:::tip\nin⟧ner\nmore\n:::\n\n# h\n',
		'x\n\n:::tip\nner\nmore\n:::\n\n# h\n',
		{ at: 10, holds: 'text' },
		true
	),
	...deleted(
		'L8 the same as a details’ first block',
		'<details open>\n<summary>Sum</summary>\n\n⟦***\n\nbody\n\n:::tip\nin⟧ner\n:::\n\n</details>\n',
		'<details open>\n<summary>Sum</summary>\n\n:::tip\nner\n:::\n\n</details>\n',
		{ at: 46, holds: 'text' }
	),
	...deleted(
		'L8 the same into a code block',
		'x\n\n⟦***\n\nbody\n\n```\nco⟧de\n```\n\n# h\n',
		'x\n\n```\nde\n```\n\n# h\n',
		{ at: 7, holds: 'text' }
	),
	...deleted(
		'L8 a block taken whole right under an opening row, into a code block',
		':::note\n⟦***\n\nbody\n\n```\nco⟧de\n```\n:::\n',
		':::note\n```\nde\n```\n:::\n',
		{ at: 12, holds: 'text' }
	),
	...deleted(
		'L8 the same into a tip inside the note',
		'::::note\n⟦***\n\n:::tip\nin⟧ner\n:::\n::::\n',
		'::::note\n:::tip\nner\n:::\n::::\n',
		{ at: 16, holds: 'text' },
		true
	),
	// The twin, a paragraph emptied from its text start, keeps its line, as ruling 2 says.
	...deleted(
		'L8 control: a paragraph emptied under a blank line keeps its line above the tip',
		'x\n\n⟦zero\n\nbody\n\n:::tip\nin⟧ner\nmore\n:::\n\n# h\n',
		'x\n\n\n:::tip\nner\nmore\n:::\n\n# h\n',
		{ at: 3, holds: 'text' }
	)
];

// Miss-analysis: the cut rows that entered a block all entered an untitled row or a fence, whose
// first line holds no text, so none showed a cut resting on a title or a header a paste then splits.
const ENTERED_CUT_ROWS: NamedRow[] = [
	...cut(
		'L8 a cut into a titled tip’s title holds the gap above the tip',
		'first\n\n⟦***\n\nbody\n\n:::tip Ti⟧tle\nin\n:::\n',
		'first\n\n:::tip tle\nin\n:::\n',
		{ at: 7, holds: 'boundary', parent: [] }
	),
	...cut(
		'L8 the same right under an opening row',
		'::::note\n⟦***\n\n:::tip Ti⟧tle\nin\n:::\n::::\n',
		'::::note\n:::tip tle\nin\n:::\n::::\n',
		{ at: 9, holds: 'boundary', parent: [0] }
	),
	...cut(
		'L8 a cut into a table’s rows holds the gap above the table',
		'first\n\n⟦***\n\nbody\n\n| a | b |\n|---|---|\n| 1 | 2 |⟧\n| 3 | 4 |\n',
		'first\n\n| a | b |\n|---|---|\n| 3 | 4 |\n',
		{ at: 7, holds: 'boundary', parent: [] }
	),
	...cut(
		'L8 the same in a note',
		':::note\n⟦***\n\n| a | b |\n|---|---|\n| 1 | 2 |⟧\n| 3 | 4 |\n:::\n',
		':::note\n| a | b |\n|---|---|\n| 3 | 4 |\n:::\n',
		{ at: 8, holds: 'boundary', parent: [0] }
	),
	...cut(
		'L8 a cut into a code block in a quote holds the gap above the quote',
		'first\n\n⟦***\n\nbody\n\n> ```\n> code⟧\n> more\n> ```\n',
		'first\n\n> ```\n> more\n> ```\n',
		{ at: 7, holds: 'boundary', parent: [] }
	),
	...cut(
		'L8 a cut into a details’ summary holds the gap above the details',
		'first\n\n⟦***\n\n<details open>\n<summary>Sum⟧</summary>\n\nbody\n\n</details>\n',
		'first\n\n<details open>\n<summary></summary>\n\nbody\n\n</details>\n',
		{ at: 7, holds: 'boundary', parent: [] }
	),
	// A cut that ends before a block it never entered lands as Delete does.
	...cut(
		'L8 control: a cut ending before a titled tip lands at its title',
		'first\n\n⟦***\n\n# hd⟧\n\n:::tip Title\nin\n:::\n',
		'first\n\n:::tip Title\nin\n:::\n',
		{ at: 14, holds: 'text' }
	),
	...cut(
		'L8 control: a cut ending before a table lands on the table',
		'first\n\n⟦***\n\n# hd⟧\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
		'first\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
		{ at: 7, holds: 'block', parent: [] }
	),
	// Miss-analysis: every `$$` row a cut ended before had its body on lines of its own, so none
	// started the formula on the opening line, where the first-line test let the cut into it.
	...cut(
		'L8 a cut ending before a one-line `$$` block holds the gap above it',
		'first\n\n⟦***\n\n# hd⟧\n\n$$m$$\n\nlast\n',
		'first\n\n$$m$$\n\nlast\n',
		{ at: 7, holds: 'boundary', parent: [] }
	)
];

// Miss-analysis: every row of text on a line of its own stood where the removal's byte is the next
// block's first, so none held that line under the blank line an opening row keeps over that block.
const OWN_LINE_ROWS: NamedRow[] = (
	[
		['a key’s text', { text: 'ж' }],
		['a paste', { paste: 'ж', plain: false, holds: 'text' }]
	] as const
).map(([name, gesture]) => ({
	name: `L5 ${name} over blocks under an opening row stands under the blank line the row keeps`,
	source: '::::note\n⟦***\n\n# end⟧\n\nnext\n::::\n',
	gesture,
	expect: { source: '::::note\n\nж\n\nnext\n::::\n', caret: { at: 11, holds: 'text' } }
}));

export const CLOSER_ROWS: NamedRow[] = [
	...CLOSING_LINE_ROWS,
	...LINE_ROWS,
	...OPENING_ROWS,
	...START_LINE_ROWS,
	...LEFT_LINE_ROWS,
	...LEFT_TITLE_ROWS,
	...LEFT_LINE_KEPT_ROWS,
	...LEFT_LINE_DROP_ROWS,
	...TEXT_AFTER_ROWS,
	...ENTERED_ROWS,
	...MIXED_ROWS,
	...MIXED_ENDING_ROWS,
	...LINE_END_ROWS,
	...COMPOSITION_ROWS,
	...LINE_BREAK_ROWS,
	...EMPTIED_LINE_ROWS,
	...BARE_START_ROWS,
	...ENTERED_CUT_ROWS,
	...OWN_LINE_ROWS
];
