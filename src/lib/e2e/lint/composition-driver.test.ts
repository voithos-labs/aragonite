/**
 * G4.49 — a spec composes through the CDP driver (`simulation/ime.ts`), never by constructing
 * composition events itself. A hand-fired `CompositionEvent` skips the browser's own composition
 * window, so the spec asserts against a sequence no IME produces: it can pass while the real
 * gesture breaks, which is what issue #46 was. Lives beside the other e2e lints, outside
 * `test:editor:invariants`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../test/invariants/lint/scan-source';

const E2E_DIR = path.resolve('src/lib/e2e');

/** Both evasions: the event itself, and the input event that carries a composition's bytes.
 *  Assembled, because this file's own scan reads a source tree it is part of. */
const HAND_FIRED = [
	new RegExp('new\\s+Composition' + 'Event\\s*\\('),
	new RegExp('insertComposition' + 'Text')
];

interface SourceFile {
	relPath: string;
	/** Comments blanked: the specs describe the very tokens this scans for. */
	code: string;
}

function e2eSources(): SourceFile[] {
	const files: SourceFile[] = [];
	function walk(dir: string, prefix: string): void {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full, `${prefix}${entry.name}/`);
			else if (entry.name.endsWith('.ts')) {
				files.push({
					relPath: prefix + entry.name,
					code: stripComments(readFileSync(full, 'utf8'))
				});
			}
		}
	}
	walk(E2E_DIR, '');
	return files;
}

const handFiredIn = (files: SourceFile[]): string[] =>
	files.filter((f) => HAND_FIRED.some((re) => re.test(f.code))).map((f) => f.relPath);

describe('G4.49 e2e composition rides the CDP driver', () => {
	const files = e2eSources();

	it('inspected the e2e sources', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('no spec constructs its own composition events', () => {
		expect(
			handFiredIn(files),
			'drive the composition through attachIme (simulation/ime.ts) — a synthetic event skips the browser composition window'
		).toEqual([]);
	});

	it('the CDP driver is where composition lives', () => {
		const driver = files.find((f) => f.relPath === 'simulation/ime.ts');
		expect(driver, 'simulation/ime.ts is the composition driver').toBeDefined();
		expect(driver!.code).toContain('Input.imeSetComposition');
	});

	// ── Matcher self-test (non-vacuity) ──────────────────────────────────────

	it('matcher flags both hand-fired shapes', () => {
		const synthetic = `new ${'Composition'}Event('compositionstart')`;
		const viaInput = `{ inputType: 'insert${'Composition'}Text' }`;
		expect(
			handFiredIn([
				{ relPath: 'a.spec.ts', code: synthetic },
				{ relPath: 'b.spec.ts', code: viaInput },
				{ relPath: 'c.spec.ts', code: 'await ime.compose("か");' }
			])
		).toEqual(['a.spec.ts', 'b.spec.ts']);
	});
});
