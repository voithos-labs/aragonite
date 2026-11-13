// Named rows for the lines a removal keeps: a closing line the range leaves stands under what is
// left of its own container, above whatever followed it, and the line after the range still starts
// a line. Each row is a cut; Backspace and Delete leave the same bytes (law 4).

import type { NamedRow } from './named-rows';

const cut = (name: string, source: string, out: string): NamedRow[] => [
	{ name, source, gesture: 'cut', expect: { source: out } },
	{ name: `${name}, live`, source, mode: 'live', gesture: 'cut', expect: { source: out } }
];

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

export const CLOSER_ROWS: NamedRow[] = [...CLOSING_LINE_ROWS];
