// Named rows for the lines a removal keeps: a closing line the range leaves stands under what is
// left of its own container, above whatever followed it, and the line after the range still starts
// a line. Each row is a cut; Backspace and Delete leave the same bytes (law 4).

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
		'L4 a block taken whole out of an open details leaves its closing line above the heading after',
		'<details open>\n<summary>Sum</summary>\n\n⟦---\n\nbody\n\n</details>\n\npara⟧\n\n# h\n',
		'<details open>\n<summary>Sum</summary>\n\n</details>\n\n# h\n'
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
		':::note\n<details open>\n<summary>Sum</summary>\n\n</details>\n:::\n\n# h\n'
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
		'<details open>\r\n<summary>Sum</summary>\r\n\r\n</details>\r\n\r\n# h\r\n'
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
		'# h\n'
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

export const CLOSER_ROWS: NamedRow[] = [
	...CLOSING_LINE_ROWS,
	...LINE_ROWS,
	...OPENING_ROWS,
	...START_LINE_ROWS
];
