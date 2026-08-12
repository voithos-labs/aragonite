/**
 * G4.41 — nothing under `src/lib` reads dev warnings around the fail-on-warn gate. A file that
 * mocks `dev-warn` replaces the function the sink lives in, and a file that spies `console.warn`
 * reads a channel a registered sink silences: either way the gate is blind for that whole file,
 * and a guard firing there passes unnoticed. Two files pin the arms themselves and say so below.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, EDITOR_SRC, type SourceFile } from './scan-source';

/** Files whose subject IS a warning channel, so reading it directly is the test. */
const CONSOLE_WARN_READERS: Record<string, string> = {
	'src/lib/test/dev-warn.test.ts':
		'pins devWarn’s console arm: the exact line shape the e2e watchers key on',
	'src/lib/test/core/url-policy.test.ts':
		'pins the blocked-scheme warning, which is production security feedback rather than a devWarn'
};

const MOCKS_DEV_WARN = /vi\s*\.\s*mock\(\s*['"`][^'"`]*dev-warn['"`]/;
const SPIES_CONSOLE_WARN = /spyOn\(\s*console\s*,\s*['"`]warn['"`]\s*\)/;

const mocksDevWarn = (file: SourceFile): boolean => MOCKS_DEV_WARN.test(file.code);
const spiesConsoleWarn = (file: SourceFile): boolean => SPIES_CONSOLE_WARN.test(file.code);

const paths = (sources: SourceFile[], matches: (file: SourceFile) => boolean): string[] =>
	sources
		.filter(matches)
		.map((file) => file.relPath)
		.sort();

describe('G4.41 warn-gate bypass census', () => {
	const sources = collectEditorSources(EDITOR_SRC, { includeTests: true });

	it('inspected the test tree', () => {
		expect(sources.some((f) => f.relPath.startsWith('src/lib/test/'))).toBe(true);
	});

	it('no file mocks dev-warn', () => {
		expect(
			paths(sources, mocksDevWarn),
			'a mocked devWarn never reaches the sink, so every guard fire in this file is invisible ' +
				'to the gate: assert on takeDevWarns() instead, or declare the tag with allowDevWarns'
		).toEqual([]);
	});

	it('the console.warn spies are exactly the two files that pin a warning channel', () => {
		expect(
			paths(sources, spiesConsoleWarn),
			'a registered sink takes reporting over, so a console spy sees nothing a dev warning ' +
				'wrote; a test asserting on one is asserting on silence'
		).toEqual(Object.keys(CONSOLE_WARN_READERS).sort());
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────
	// Spelled in parts, since this file sits in the scan's own scope: a literal fixture
	// would make the census flag its own self-tests.

	const quoted = (mark: string, text: string) => `${mark}${text}${mark}`;
	const mockCall = (spec: string) => `vi.${'mock'}(${quoted("'", spec)}, () => ({}));`;
	const spyCall = (mark: string, channel: string) =>
		`vi.spyOn(console, ${quoted(mark, channel)}).mockImplementation(() => {});`;

	const probe = (matches: (file: SourceFile) => boolean, code: string) =>
		matches({ relPath: 'x', text: '', code });

	it('the mock matcher reads both import spellings and skips a mock of something else', () => {
		expect(probe(mocksDevWarn, mockCall('$lib/dev-warn'))).toBe(true);
		expect(probe(mocksDevWarn, mockCall('../../dev-warn'))).toBe(true);
		expect(probe(mocksDevWarn, mockCall('esm-env'))).toBe(false);
	});

	it('the spy matcher reads both quote styles and skips the other console channels', () => {
		expect(probe(spiesConsoleWarn, spyCall("'", 'warn'))).toBe(true);
		expect(probe(spiesConsoleWarn, spyCall('`', 'warn'))).toBe(true);
		expect(probe(spiesConsoleWarn, spyCall("'", 'error'))).toBe(false);
	});
});
