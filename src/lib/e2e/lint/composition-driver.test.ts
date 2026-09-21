/**
 * G4.49: a spec composes through the shared driver (`simulation/ime.ts`) instead of building
 * composition events itself. A hand-built `CompositionEvent` skips the browser's own composition
 * window, so the spec checks a sequence no IME produces and can pass while real typing breaks.
 * WebKit exposes no CDP, so the driver holds the one hand-built branch. Runs beside the other
 * e2e lints, outside `test:editor:invariants`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../test/invariants/lint/scan-source';

const E2E_DIR = path.resolve('src/lib/e2e');

/** The only file the ban exempts, and the only one that may build the events by hand. */
const DRIVER = 'simulation/ime.ts';

/** Both ways around the ban: the event itself, and the input event carrying a composition's
 *  bytes. Built from pieces, so the scan does not match this file, which it also reads. */
const HAND_FIRED = [
	new RegExp('new\\s+Composition' + 'Event\\s*\\('),
	new RegExp('insertComposition' + 'Text')
];

interface SourceFile {
	relPath: string;
	/** Comments are blanked: the specs describe in prose the very tokens this scans for. */
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

describe('G4.49 e2e composition rides the shared IME driver', () => {
	const files = e2eSources();

	it('inspected the e2e sources', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('no spec constructs its own composition events', () => {
		expect(
			handFiredIn(files.filter((file) => file.relPath !== DRIVER)),
			'drive the composition through attachIme (simulation/ime.ts): a synthetic event skips the browser composition window'
		).toEqual([]);
	});

	it('the CDP branch is where Chromium composition lives', () => {
		const driver = files.find((file) => file.relPath === DRIVER);
		expect(driver, `${DRIVER} is the composition driver`).toBeDefined();
		expect(driver!.code).toContain('Input.imeSetComposition');
	});

	it('the hand-fired shape lives in the driver and nowhere else', () => {
		// Exact both ways: widening the exemption grows this list, dropping the WebKit branch
		// empties it.
		expect(handFiredIn(files), `the hand-fired branch belongs to ${DRIVER} alone`).toEqual([
			DRIVER
		]);
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
