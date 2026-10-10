/**
 * Every e2e switch of the presentation mode waits for the editor to show the mode (G4.133): through
 * `EditorPage.setPresentationMode`, `EditorPage.goto`'s query, or `clickModeToggle` /
 * `clickModeButton` (`e2e/mode-switch.ts`). A switch that never applies leaves source mode, where
 * most assertions pass anyway. An alias of `__test` held across statements still gets past it.
 * Miss-analysis: two selection specs stayed green with the harness dropping live mode to source.
 */
import { describe, it, expect } from 'vitest';
import { collectFiles, readSource, type SourceFile } from '../../test/invariants/lint/scan-source';

const E2E_DIR = 'src/lib/e2e';
const BRIDGE_HOME = 'src/lib/e2e/editor-page.ts';
const CONTROL_HOME = 'src/lib/e2e/mode-switch.ts';

const BRIDGE_CALL =
	/\b__test\b[^;]*?\bsetPresentationMode\b|\bsetPresentationMode\b[^;]*?=\s*[^;]*?\b__test\b/g;
// The test route's header checkboxes, and the showcase's and changelog's mode buttons.
const MODE_CONTROL =
	/\b(?:presentation|live|preview-block|preview-inline)-toggle\b|\b(?:showcase|changelog)-mode\b/g;

const CONTROL_ALLOWED: Record<string, string> = {
	'src/lib/e2e/tests/keybinding-multi-editor.spec.ts':
		'focuses the reading toggle without clicking it, so the mode never changes',
	'src/lib/e2e/tests/mobile-showcase.spec.ts':
		'taps a mode button on a phone layout and checks the mode itself'
};

const lineOf = (code: string, index: number) => code.slice(0, index).split('\n').length;

const sites = (files: Pick<SourceFile, 'relPath' | 'code'>[], pattern: RegExp): string[] =>
	files.flatMap((file) =>
		[...file.code.matchAll(pattern)].map(
			(m) => `${file.relPath}:${lineOf(file.code, m.index)} ${m[0].replace(/\s+/g, ' ')}`
		)
	);

const outside = (files: SourceFile[], allowed: string[]) =>
	files.filter((file) => !allowed.includes(file.relPath));

describe('G4.133 every e2e mode switch waits for the mode to apply', () => {
	const files = collectFiles(E2E_DIR, { extensions: ['.ts'] }).map(readSource);

	it('inspected the e2e sources', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('no spec or helper calls the bridge mode setter itself', () => {
		expect(
			sites(outside(files, [BRIDGE_HOME]), BRIDGE_CALL),
			`call EditorPage.setPresentationMode (${BRIDGE_HOME}), which waits for the mode to apply`
		).toEqual([]);
	});

	it('no spec or helper reaches a mode toggle or mode button itself', () => {
		expect(
			sites(outside(files, [CONTROL_HOME, ...Object.keys(CONTROL_ALLOWED)]), MODE_CONTROL),
			`click it with clickModeToggle or clickModeButton (${CONTROL_HOME}), which wait for the mode to apply`
		).toEqual([]);
	});

	it('each home and allowed file still holds what it is listed for', () => {
		const holds = (relPath: string, pattern: RegExp) =>
			sites(
				files.filter((file) => file.relPath === relPath),
				pattern
			).length > 0;
		expect(holds(BRIDGE_HOME, BRIDGE_CALL), BRIDGE_HOME).toBe(true);
		for (const relPath of [CONTROL_HOME, ...Object.keys(CONTROL_ALLOWED)]) {
			expect(holds(relPath, MODE_CONTROL), relPath).toBe(true);
		}
	});

	// ── Matcher self-test (non-vacuity) ──────────────────────────────────────

	it('matcher flags the bridge setter in any spelling, and spares the page object', () => {
		// Spelled in pieces, so the scan of this file does not read them as calls.
		const bridge = '(window as any).__' + 'test';
		const setter = 'setPresentation' + 'Mode';
		const flagged = sites(
			[
				{ relPath: 'a.ts', code: `await page.evaluate(() => ${bridge}.${setter}('live'));` },
				{ relPath: 'b.ts', code: `page.evaluate((m) =>\n\t${bridge}\n\t\t.${setter}(m), mode);` },
				{ relPath: 'c.ts', code: `const { ${setter} } = ${bridge};` },
				{ relPath: 'd.ts', code: `${bridge}['${setter}']('reading');` },
				{ relPath: 'e.ts', code: `await ep.${setter}('live');` },
				{
					relPath: 'f.ts',
					code: `await page.evaluate(() => ${bridge}.getSource());\nawait ep.${setter}('live');`
				}
			],
			BRIDGE_CALL
		);
		expect(flagged.map((site) => site.split(':')[0])).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
	});

	it('matcher flags every mode control, and spares look-alikes', () => {
		const flagged = sites(
			[
				{ relPath: 'a.ts', code: `page.getByTestId('live-${'toggle'}')` },
				{ relPath: 'b.ts', code: `['reading', 'presentation-${'toggle'}']` },
				{ relPath: 'c.ts', code: `testid: 'preview-inline-${'toggle'}'` },
				{ relPath: 'd.ts', code: `page.locator('.showcase-${'mode'}[data-mode="live"]')` },
				{ relPath: 'e.ts', code: `page.locator('.changelog-${'mode'}')` },
				{ relPath: 'f.ts', code: `page.getByTestId('theme-${'toggle'}')` },
				{ relPath: 'g.ts', code: `page.locator('.showcase-${'modes'}')` },
				{ relPath: 'h.ts', code: `await clickModeToggle(page, 'live');` }
			],
			MODE_CONTROL
		);
		expect(flagged.map((site) => site.split(':')[0])).toEqual([
			'a.ts',
			'b.ts',
			'c.ts',
			'd.ts',
			'e.ts'
		]);
	});
});
