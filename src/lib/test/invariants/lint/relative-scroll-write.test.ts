/**
 * G4.66 — a relative scroll goes through `Scrollport.scrollBy`, never a hand-rolled
 * `setScrollTop(scrollTop() + delta)`. A scroller snaps a fractional write and reports the
 * snapped value back, so the hand-rolled spelling drops the fraction once per correction and
 * slides the reader by the sum (#315). The carry that holds it lives inside the port.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, type SourceFile } from './scan-source';

/** The port defines both writes, so it is the one file free to spell either out. */
const PORT = 'src/lib/cursor/scrollport.ts';

/** The corrector the rule was written for: the scan is vacuous if it stops reaching it. */
const CORRECTORS = [
	'src/lib/reactivity/list-windowing.svelte.ts',
	'src/lib/components/editor-root-geometry.ts'
];

/** The read feeding its own write inside one statement, whatever sits between them. */
const RELATIVE_WRITE = /setScrollTop\s*\([^;]*?\.scrollTop\s*\(\s*\)/;

const writesRelatively = (file: SourceFile): boolean => RELATIVE_WRITE.test(file.code);

describe('G4.66 a relative scroll is written through scrollBy', () => {
	const sources = collectEditorSources().filter((file) => file.relPath !== PORT);

	it('reaches the correctors the rule is about', () => {
		const scanned = sources.map((file) => file.relPath);
		for (const corrector of CORRECTORS) expect(scanned).toContain(corrector);
	});

	it('no module adds a delta to the position it just read', () => {
		const offenders = sources.filter(writesRelatively).map((file) => file.relPath);
		expect(
			offenders,
			`a relative scroll must go through port.scrollBy(delta), which carries the fraction the scroller refuses: ${offenders.join(', ')}`
		).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	const probe = (code: string) => writesRelatively({ relPath: 'x', text: '', code });

	it('the matcher sees the banned spelling, in either sign', () => {
		expect(probe('port.setScrollTop(port.scrollTop() + delta);')).toBe(true);
		expect(probe('el.setScrollTop(el.scrollTop() - lost);')).toBe(true);
	});

	it('the matcher leaves an absolute write alone, even beside a read', () => {
		expect(probe('port.setScrollTop(target);\nconst at = port.scrollTop();')).toBe(false);
		expect(probe('port.setScrollTop(listTopInPort(port, listEl) + model.offsetOf(index));')).toBe(
			false
		);
	});

	it('an undeclared module writing relatively fails the census', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/rogue.ts',
			text: '',
			code: 'port.setScrollTop(port.scrollTop() + delta);'
		};
		expect([...sources, rogue].filter(writesRelatively).map((file) => file.relPath)).toEqual([
			rogue.relPath
		]);
	});
});
