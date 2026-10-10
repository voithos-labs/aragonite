/**
 * The lint scans' path table names the files and directories it means, and the scans read their
 * paths from it, so a move that forgets the table fails here at once instead of leaving a scan
 * reading nothing, or reading the wrong file.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
	collectFiles,
	fileClasses,
	literalSpans,
	openerBefore,
	readSource,
	sourceFile,
	stringLiteralAt,
	type SourceFile
} from './scan-source';
import { SOURCE, SOURCE_ANCHORS, SOURCE_DIR, SOURCE_DIR_ANCHORS } from './source-paths';

const kindOnDisk = (relPath: string): 'file' | 'directory' | 'missing' => {
	const full = path.resolve(relPath);
	if (!existsSync(full)) return 'missing';
	return statSync(full).isDirectory() ? 'directory' : 'file';
};

// ── Hard-coded paths in a scan ───────────────────────────────────────────────

/** Calls whose path argument decides which files a scan reads or walks. */
const READS = new Set([
	'readSource',
	'readFileSync',
	'under',
	'notUnder',
	'except',
	'startsWith',
	'collectEditorSources',
	'collectFiles',
	'resolve',
	'join'
]);

/** Every source path literal a scan reads or walks by hand: an argument to one of `READS`, an
 *  entry of a `reaches` or `mustMatch` list, or one side of a `relPath` comparison. */
export function hardCodedPaths(file: SourceFile): string[] {
	const classes = fileClasses(file);
	const found: string[] = [];
	for (const span of literalSpans(file.code)) {
		const value = stringLiteralAt(file.code, span.start)?.value;
		if (value === undefined || !/^(?:src|examples)\//.test(value)) continue;
		if (isReadPosition(file.code, span.start, classes)) found.push(`${file.relPath}: ${value}`);
	}
	return found;
}

function isReadPosition(code: string, at: number, classes: Uint8Array): boolean {
	if (/\brelPath\s*[!=]==\s*$/.test(code.slice(0, at))) return true;
	const opener = openerBefore(code, at, classes);
	if (opener === null) return false;
	const head = code.slice(0, opener);
	const bracket = code.slice(opener, opener + 1);
	if (bracket === '[') return /\b(?:reaches|mustMatch)\s*:\s*$/.test(head);
	return bracket === '(' && READS.has(/(\w+)\s*$/.exec(head)?.[1] ?? '');
}

/** The table and its own test name paths by design. */
const TABLE_FILES = new Set(['source-paths.ts', 'source-paths.test.ts']);

// ── The table ────────────────────────────────────────────────────────────────

describe('the lint path table', () => {
	it('every file entry is a file on disk', () => {
		const wrong = Object.entries(SOURCE)
			.filter(([, relPath]) => kindOnDisk(relPath) !== 'file')
			.map(([key, relPath]) => `${key}: ${relPath} is ${kindOnDisk(relPath)}`);
		expect(wrong).toEqual([]);
	});

	// Read at collection, which no test timeout bounds: every entry is a file read.
	const anchorOf = (key: string) => SOURCE_ANCHORS[key as keyof typeof SOURCE];
	const anchorless = Object.entries(SOURCE)
		.filter(([key, relPath]) => {
			if (kindOnDisk(relPath) !== 'file') return false;
			return !readSource(relPath).text.includes(anchorOf(key));
		})
		.map(([key, relPath]) => `${key}: ${relPath} lacks ${JSON.stringify(anchorOf(key))}`);

	it('every file entry holds its anchor, so it names the file it means', () => {
		expect(anchorless).toEqual([]);
	});

	it('every directory entry is a directory on disk, written with its trailing slash', () => {
		const wrong = Object.entries(SOURCE_DIR)
			.filter(([, relPath]) => !relPath.endsWith('/') || kindOnDisk(relPath) !== 'directory')
			.map(([key, relPath]) => `${key}: ${relPath} is ${kindOnDisk(relPath)}`);
		expect(wrong).toEqual([]);
	});

	it('every directory entry holds its anchor', () => {
		const wrong = Object.entries(SOURCE_DIR)
			.map(([key, relPath]) => `${relPath}${SOURCE_DIR_ANCHORS[key as keyof typeof SOURCE_DIR]}`)
			.filter((anchor) => kindOnDisk(anchor) === 'missing');
		expect(wrong).toEqual([]);
	});

	// Two keys for one path drift apart the first time a move updates only one of them.
	it('no path is listed twice', () => {
		const paths = [...Object.values(SOURCE), ...Object.values(SOURCE_DIR)];
		expect(paths.filter((relPath, i) => paths.indexOf(relPath) !== i)).toEqual([]);
	});
});

// ── The scans read through the table ────────────────────────────────────────

describe('the lint scans name no source path by hand', () => {
	const scans = collectFiles(SOURCE_DIR.unitLint, { extensions: ['.ts'] })
		.filter((relPath) => !TABLE_FILES.has(path.posix.basename(relPath)))
		.map(readSource);

	it('read the lint directory', () => {
		expect(scans.length).toBeGreaterThan(50);
	});

	const found = scans.flatMap(hardCodedPaths);

	it('every path a scan reads or walks comes from the table', () => {
		expect(
			found,
			`take these paths from source-paths.ts, so a move is one edit and a moved file can't leave a scan reading nothing:\n${found.join('\n')}`
		).toEqual([]);
	});

	it('flags each read shape and spares allowlist keys and probes', () => {
		const flagged = (code: string) => hardCodedPaths(sourceFile('x.test.ts', code));
		expect(flagged("readSource('src/lib/a.ts');")).toHaveLength(1);
		expect(flagged("const p = notUnder('src/lib/selection/');")).toHaveLength(1);
		expect(flagged("collectEditorSources(path.resolve('src/lib/plugins'));")).toHaveLength(1);
		expect(flagged("const r = { reaches: ['src/lib/a.ts', SOURCE.b] };")).toHaveLength(1);
		expect(
			flagged("files.filter((f) => f.relPath === 'examples/consumer/src/a.ts');")
		).toHaveLength(1);
		expect(flagged("const allowed = { 'src/lib/a.ts': 'why' };")).toEqual([]);
		expect(flagged("hits: [at('src/lib/x/rogue.ts', 'x();')]")).toEqual([]);
		expect(flagged("// readSource('src/lib/a.ts')")).toEqual([]);
	});
});
