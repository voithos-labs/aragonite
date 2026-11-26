// The link definition's declaration of a reading that isn't final, held to what an edit's window
// leans on: once final it stays final with more lines under it, a blank line ends the wait, and
// `crosses` names the lines a title runs on across, as the parser reads them.
// Miss-analysis: the declaration answered "not final" for every definition with no title, so a
// window could not ask it where a wait ends, and nothing held it to the parser line for line.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parse } from '#lib/core/parser.js';
import {
	unfinishedReadings,
	type GrammarView,
	type UnclosedInGrammar
} from '#lib/schema/block-openers.js';
import { SYNTAX_PLUGINS } from '../../behavior/corpus';
import { syntaxGrammar } from '../../support/syntax-grammar';
import { freshOrFixedSeed } from '../../invariants/arbitraries/property-seed';

/** The one reading the built-in grammar holds that no line closes. */
const definitionReading = (grammar: GrammarView): UnclosedInGrammar =>
	unfinishedReadings(grammar).find(
		(reading): reading is UnclosedInGrammar => reading.closer === null
	)!;

/** Lines a definition is made of, whole and cut short, beside lines that read as other blocks. */
const PARTS = [
	'[a]: /u',
	'[a]:',
	'[a',
	'b]: /u',
	'/u',
	'"t',
	"'t",
	'(t',
	't"',
	"t'",
	't)',
	'    "code',
	'[a]: /u "t',
	'[b]: /v "x"',
	'[^1]: note',
	'text',
	'# h',
	'***',
	'- item',
	'===',
	'',
	'   '
];

/** Lines with no quote or paren of their own, so only where a title may run decides its end. */
const UNDER_A_TITLE = [
	'text',
	'# h',
	'#h',
	'***',
	'---',
	'===',
	'=',
	'- item',
	'-item',
	'1. one',
	'2. two',
	'> q',
	'```',
	'~~~',
	'    code',
	'\tcode',
	'[b]: /v',
	'<div>',
	'<span>',
	'<!-- c -->',
	'| a | b |',
	'$$',
	':::note',
	'<details>',
	'[^1]: note',
	'+ x',
	'* * *',
	'a  '
];

const arbEol = fc.constantFrom('\n', '\r\n');
const joined = (lines: readonly string[], eol: string) => lines.map((line) => line + eol).join('');

describe.each([
	['the built-in grammar', []],
	['every bundled syntax plugin', SYNTAX_PLUGINS]
] as const)('a link definition’s reading under %s', (_name, plugins) => {
	it('once final on some lines, stays final with more under them', () => {
		const { notFinal } = definitionReading(syntaxGrammar(plugins));
		fc.assert(
			fc.property(
				fc.array(fc.constantFrom(...PARTS), { minLength: 1, maxLength: 7 }),
				arbEol,
				(lines, eol) => {
					let final = false;
					for (let count = 1; count <= lines.length; count++) {
						const now = !notFinal(joined(lines.slice(0, count), eol));
						expect(final && !now, `${JSON.stringify(lines)} at ${count} lines`).toBe(false);
						final = now;
					}
				}
			),
			{ numRuns: 500, seed: freshOrFixedSeed(20261113) }
		);
	});

	it('is final on any lines a blank line cuts', () => {
		const { notFinal } = definitionReading(syntaxGrammar(plugins));
		const arbLines = fc.array(fc.constantFrom(...PARTS), { minLength: 1, maxLength: 4 });
		fc.assert(
			fc.property(arbLines, arbLines, arbEol, (above, below, eol) => {
				expect(notFinal(joined([...above, '', ...below], eol))).toBe(false);
			}),
			{ numRuns: 500, seed: freshOrFixedSeed(20261114) }
		);
	});

	it.each(UNDER_A_TITLE)('crosses `%s` exactly when a title runs on across it', (line) => {
		const grammar = syntaxGrammar(plugins);
		const blocks = parse(`[a]: /u\n"t\n${line}\nend"\n`, { grammar }).children;
		const oneDefinition = blocks.length === 1 && blocks[0].kind === 'linkReferenceDefinition';
		expect(definitionReading(grammar).crosses!(line)).toBe(oneDefinition);
	});
});
