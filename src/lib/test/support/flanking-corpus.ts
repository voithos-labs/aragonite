/**
 * The shared CommonMark §6.2 emphasis-flanking cases. Kept in one place because two suites run
 * them against different code, `inline-conformance` against `parseInline` (G2.3) and
 * `emphasis-flanking` against the `scanInline` scanner, and the two must never drift apart.
 */

export interface FlankingCase {
	name: string;
	source: string;
	emphasis: boolean;
	runs?: string[];
}

export const FLANKING_CASES: FlankingCase[] = [
	// Left-flanking opener requires a non-whitespace char after the run.
	{ name: 'opener followed by space cannot open', source: '* foo*', emphasis: false },
	{ name: 'closer preceded by space cannot close', source: '*foo *', emphasis: false },
	{ name: 'tight run emphasizes', source: '*foo*', emphasis: true, runs: ['*foo*'] },
	// `*` permits intra-word emphasis (no punctuation restriction).
	{ name: 'intra-word * emphasizes', source: 'foo*bar*baz', emphasis: true, runs: ['*bar*'] },
	// Punctuation-flanking: both the outer and inner runs pair.
	{
		name: 'run surrounded by punctuation pairs',
		source: '*(*foo*)*',
		emphasis: true,
		runs: ['*(*foo*)*', '*foo*']
	}
];

export const INTRA_WORD_UNDERSCORE_CASES: FlankingCase[] = [
	{ name: 'intra-word _ stays literal', source: 'foo_bar_baz', emphasis: false },
	{ name: 'opening _ mid-word cannot open', source: '_foo_bar', emphasis: false },
	{ name: 'closing _ mid-word cannot close', source: 'foo bar_baz_', emphasis: false },
	{
		name: '_ with whitespace boundaries emphasizes',
		source: 'foo _bar_ baz',
		emphasis: true,
		runs: ['_bar_']
	},
	{ name: '_ after punctuation can open', source: '(_foo_)', emphasis: true, runs: ['_foo_'] }
];
