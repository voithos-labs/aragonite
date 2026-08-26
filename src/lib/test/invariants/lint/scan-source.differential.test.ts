/**
 * G4.57 — the guards' own lexer, held against TypeScript's. Every source-scan census reads code
 * through `spanAt`, so a literal it misreads shrinks a dozen populations at once with nothing
 * red. Each character of every scanned `.ts` file and every `.svelte` script block is classified
 * comment/string/template/regex/code by both, and the two must agree. TypeScript cannot lex
 * markup, so the markup half is pinned against a corpus instead.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { parse, type AST } from 'svelte/compiler';
import {
	collectEditorSources,
	lexicalClasses,
	LEXICAL_CLASSES,
	type SourceFile
} from './scan-source';

const classOf = (name: (typeof LEXICAL_CLASSES)[number]): number => LEXICAL_CLASSES.indexOf(name);

// ── The TypeScript oracle ────────────────────────────────────────────────────

const TOKEN_CLASS = new Map<ts.SyntaxKind, number>([
	[ts.SyntaxKind.SingleLineCommentTrivia, classOf('comment')],
	[ts.SyntaxKind.MultiLineCommentTrivia, classOf('comment')],
	[ts.SyntaxKind.ShebangTrivia, classOf('comment')],
	[ts.SyntaxKind.StringLiteral, classOf('string')],
	[ts.SyntaxKind.NoSubstitutionTemplateLiteral, classOf('template')],
	[ts.SyntaxKind.TemplateHead, classOf('template')],
	[ts.SyntaxKind.TemplateMiddle, classOf('template')],
	[ts.SyntaxKind.TemplateTail, classOf('template')],
	[ts.SyntaxKind.RegularExpressionLiteral, classOf('regex')]
]);

/** A `/` opens a regex, and a `}` resumes a template, only where the PARSER says so; the bare
 *  scanner lexes a regex body as tokens and finds comments inside it. */
function rescanPoints(sourceFile: ts.SourceFile): { regex: Set<number>; template: Set<number> } {
	const regex = new Set<number>();
	const template = new Set<number>();
	const visit = (node: ts.Node): void => {
		if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
			regex.add(node.getStart(sourceFile));
		} else if (
			node.kind === ts.SyntaxKind.TemplateMiddle ||
			node.kind === ts.SyntaxKind.TemplateTail
		) {
			template.add(node.getStart(sourceFile));
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(sourceFile, visit);
	return { regex, template };
}

function typescriptClasses(text: string, fileName: string): Uint8Array {
	const out = new Uint8Array(text.length);
	const points = rescanPoints(
		ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
	);
	const scanner = ts.createScanner(
		ts.ScriptTarget.Latest,
		false,
		ts.LanguageVariant.Standard,
		text
	);
	for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
		const start = scanner.getTokenStart();
		const isSlash = token === ts.SyntaxKind.SlashToken || token === ts.SyntaxKind.SlashEqualsToken;
		if (isSlash && points.regex.has(start)) token = scanner.reScanSlashToken();
		else if (token === ts.SyntaxKind.CloseBraceToken && points.template.has(start)) {
			token = scanner.reScanTemplateToken(false);
		}
		const cls = TOKEN_CLASS.get(token);
		if (cls !== undefined) out.fill(cls, start, scanner.getTokenEnd());
	}
	return out;
}

// ── Svelte scripts ───────────────────────────────────────────────────────────

/** Svelte types a script body as an estree `Program`, which drops the offsets its parse sets. */
function bodyRange(block: AST.Script): [number, number] {
	const { start, end } = block.content as unknown as { start: number; end: number };
	return [start, end];
}

/** The `<script>` bodies, the only part of a `.svelte` file TypeScript can lex. */
function scriptRanges(text: string): Array<[number, number]> {
	const ast = parse(text, { modern: true });
	return [ast.module, ast.instance]
		.flatMap((block) => (block ? [bodyRange(block)] : []))
		.sort((a, b) => a[0] - b[0]);
}

/** Markup blanked rather than cut out, so a script offset stays where the hand lexer read it. */
function maskOutsideScripts(text: string, ranges: Array<[number, number]>): string {
	const chars: string[] = Array.from(text, (ch) => (ch === '\n' ? '\n' : ' '));
	for (const [from, to] of ranges) for (let i = from; i < to; i++) chars[i] = text[i];
	return chars.join('');
}

// ── The differential ─────────────────────────────────────────────────────────

function lineColumn(text: string, index: number): string {
	const before = text.slice(0, index);
	return `${before.split('\n').length}:${index - before.lastIndexOf('\n')}`;
}

/** The first character the two lexers read differently, rendered so a red diagnoses itself. */
function firstDivergence(
	file: SourceFile,
	hand: Uint8Array,
	oracle: Uint8Array,
	ranges: Array<[number, number]>
): string | null {
	for (const [from, to] of ranges) {
		for (let i = from; i < to; i++) {
			if (hand[i] === oracle[i]) continue;
			const around = file.text.slice(Math.max(0, i - 20), i + 20).replace(/\n/g, '\\n');
			const read = `hand=${LEXICAL_CLASSES[hand[i]]} ts=${LEXICAL_CLASSES[oracle[i]]}`;
			return `${file.relPath}:${lineColumn(file.text, i)} ${read} in ${around}`;
		}
	}
	return null;
}

function divergenceIn(file: SourceFile, hand: Uint8Array): string | null {
	if (!file.relPath.endsWith('.svelte')) {
		const oracle = typescriptClasses(file.text, file.relPath);
		return firstDivergence(file, hand, oracle, [[0, file.text.length]]);
	}
	const ranges = scriptRanges(file.text);
	if (ranges.length === 0) return null;
	const masked = maskOutsideScripts(file.text, ranges);
	return firstDivergence(file, hand, typescriptClasses(masked, file.relPath), ranges);
}

// ── The markup half ──────────────────────────────────────────────────────────

/** One letter per class, so a pinned reading sits under its own source. */
const CLASS_LETTERS = '.cstr';

function classLine(source: string): string {
	return Array.from(lexicalClasses(source), (cls) => CLASS_LETTERS[cls]).join('');
}

/** Markup shapes TypeScript cannot lex. The last three record a simplification rather than the
 *  truth: a `/` after a bare keyword, an interpolation inside a quoted attribute, and an
 *  apostrophe in prose. Each is confined to its line and blanks nothing, and no census reads a
 *  shape like it today, so the pin marks the boundary instead of hiding it. */
const MARKUP_CORPUS: Array<[source: string, classes: string]> = [
	['{a}/{b /* c */}', '.......ccccccc.'],
	['<Foo {...rest} /><Bar {...rest} />', '.'.repeat(34)],
	['<a href="https://x">', '........sssssssssss.'],
	['{#if /^a$/.test(v)}', '...................'],
	['<b class="a-{f(x)}">', '.........ssssssssss.'],
	["<p>Sam's list</p>", '......sssssssssss']
];

describe('G4.57 the scan lexer reads what TypeScript reads', () => {
	const classified = collectEditorSources().map((file) => ({
		file,
		hand: lexicalClasses(file.text)
	}));

	it('reached the scanned trees, with every class represented', () => {
		expect(classified.length).toBeGreaterThan(0);
		const seen = new Set<number>();
		for (const { hand } of classified) for (const cls of hand) seen.add(cls);
		expect([...seen].sort((a, b) => a - b)).toEqual(LEXICAL_CLASSES.map((_, index) => index));
	});

	it('every scanned character lexes the same as TypeScript reads it', () => {
		const found = classified
			.map(({ file, hand }) => divergenceIn(file, hand))
			.filter((report) => report !== null);
		expect(
			found,
			'fix the lexer in scan-source.ts, or pin the shape here with the reason no census can move'
		).toEqual([]);
	});

	// Without this the differential guards a shadow lexer: the censuses read `stripComments`,
	// never `lexicalClasses`, and only this ties the two to one reading.
	it('stripComments blanks exactly the comment class', () => {
		const comment = classOf('comment');
		const mismatches: string[] = [];
		for (const { file, hand } of classified) {
			for (let i = 0; i < file.text.length; i++) {
				const isBlanked = hand[i] === comment && file.text[i] !== '\n';
				if (file.code[i] === (isBlanked ? ' ' : file.text[i])) continue;
				mismatches.push(`${file.relPath}:${lineColumn(file.text, i)}`);
				break;
			}
		}
		expect(mismatches).toEqual([]);
	});

	it('markup shapes TypeScript cannot lex keep their class', () => {
		for (const [source, classes] of MARKUP_CORPUS) expect(classLine(source), source).toBe(classes);
	});

	// ── Oracle self-tests (non-vacuity) ──────────────────────────────────────

	const PROBE =
		'const half = total / 2;\nconst re = /\'"/.test(s); // done\nconst t = `a ${b /* c */} d`;';

	it('the oracle tells a division from a regex and reads inside both', () => {
		const classes = typescriptClasses(PROBE, 'probe.ts');
		const classAt = (needle: string): string => LEXICAL_CLASSES[classes[PROBE.indexOf(needle)]];
		expect(classAt('/ 2')).toBe('code');
		expect(classAt('\'"')).toBe('regex');
		expect(classAt('// done')).toBe('comment');
		expect(classAt('a ${')).toBe('template');
		expect(classAt('b /*')).toBe('code');
		expect(classAt('/* c */')).toBe('comment');
	});

	it('the report names the first divergent character', () => {
		const file: SourceFile = { relPath: 'p.ts', text: 'a\nconst x = 1;', code: '' };
		const hand = lexicalClasses(file.text);
		const oracle = hand.slice();
		oracle[7] = classOf('string');
		expect(firstDivergence(file, hand, oracle, [[0, file.text.length]])).toContain(
			'p.ts:2:6 hand=code ts=string'
		);
	});
});
