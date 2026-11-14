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

/** Delete's rows in both modes, and a composition's where `composes`, which lands where Delete does. */
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
	...deleted(
		'L8 a range that stops before a tip it never entered lands on the tip’s first byte',
		':::note\n⟦***\n\nbody\n:::\n\npara⟧\n\n:::tip\ninner\n:::\n\n# h\n',
		':::note\n:::\n\n:::tip\ninner\n:::\n\n# h\n',
		{ at: 13, holds: 'text' }
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

/** A line break's rows in both modes: Enter and Shift+Enter over the range remove it this way. */
const broken = (name: string, source: string, out: string, caret: Caret) =>
	(['source', 'live'] as const).map((mode): NamedRow => ({
		name: `${name}, a line break, ${mode}`,
		source,
		mode,
		gesture: 'break',
		expect: { source: out, caret }
	}));

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
		'L8 a tip entered to a block’s end, at the block after inside it',
		'⟦***\n\nbody\n\n:::tip\ninner⟧\n\nmore\n:::\n',
		':::tip\nmore\n:::\n',
		{ at: 7, holds: 'text' }
	),
	...broken(
		'L8 from inside a note, an item’s first line taken, past the indent of the line after',
		':::note\n⟦***\n\nbody\n\n- inner⟧\n  more\n:::\n\n# h\n',
		':::note\n  more\n:::\n\n# h\n',
		{ at: 10, holds: 'text' }
	),
	...broken(
		'L8 a range ending between blocks breaks at the end of the block before',
		'first\n\n⟦***\n\npara⟧\n\n> quote\n',
		'first\n\n> quote\n',
		{ at: 5, holds: 'text' }
	),
	...broken(
		'L8 the same before a code block',
		'first\n\n⟦***\n\npara⟧\n\n```\ncode\n```\n',
		'first\n\n```\ncode\n```\n',
		{ at: 5, holds: 'text' }
	),
	...broken(
		'L8 a tip’s opening line after the range takes no break, so the gap before the tip does',
		'⟦***\n\npara⟧\n\n:::tip\nbody\n:::\n',
		':::tip\nbody\n:::\n',
		{ at: 0, holds: 'boundary', parent: [] }
	),
	...broken(
		'L8 the same for a tip that ends what the range entered',
		'⟦***\n\nbody\n\n::::note\ninner⟧\n\n:::tip\nmore\n:::\n::::\n',
		'::::note\n:::tip\nmore\n:::\n::::\n',
		{ at: 9, holds: 'boundary', parent: [0] }
	),
	...broken(
		'L8 and for a title the range ends in',
		'⟦***\n\nbody\n\n:::tip Ti⟧tle\ninner\n:::\n',
		':::tip tle\ninner\n:::\n',
		{ at: 0, holds: 'boundary', parent: [] }
	),
	{
		name: 'L8 any other command key’s removal still lands at the end of the block before',
		source: 'first\n\n⟦***\n\nbody\n\n::::note\n:::tip\nin⟧ner\n:::\n::::\n',
		gesture: 'command',
		expect: { caret: { at: 5, holds: 'text' } }
	}
];

export const CLOSER_ROWS: NamedRow[] = [
	...CLOSING_LINE_ROWS,
	...LINE_ROWS,
	...OPENING_ROWS,
	...START_LINE_ROWS,
	...TEXT_AFTER_ROWS,
	...ENTERED_ROWS,
	...MIXED_ROWS,
	...LINE_END_ROWS,
	...LINE_BREAK_ROWS
];
