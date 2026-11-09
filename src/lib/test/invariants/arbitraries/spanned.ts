// One quote or one table alone, the containers whose parse records where each child sits: lazy and
// blank `>` lines, nested quotes, code, short and long rows, CRLF, with or without a final break.
import fc from 'fast-check';

const quoteLine = fc.constantFrom(
	'> text',
	'> two words',
	'>',
	'> ',
	'> > nested',
	'> - item',
	'>     code',
	'> ```',
	'lazy line',
	'> wörld ☃'
);
const tableRow = fc.constantFrom('| a | b |', '| one |', '| x | y | z |', '|  |  |', 'a | b');

export const arbQuoteDoc: fc.Arbitrary<string> = fc
	.tuple(fc.array(quoteLine, { minLength: 1, maxLength: 14 }), fc.constantFrom('\n', '\r\n'))
	.chain(([lines, ending]) =>
		fc.boolean().map((closed) => '> first' + ending + lines.join(ending) + (closed ? ending : ''))
	);

export const arbTableDoc: fc.Arbitrary<string> = fc
	.tuple(fc.array(tableRow, { maxLength: 12 }), fc.constantFrom('\n', '\r\n'), fc.boolean())
	.map(
		([rows, ending, closed]) =>
			['| h | i |', '| --- | :-: |', ...rows].join(ending) + (closed ? ending : '')
	);
