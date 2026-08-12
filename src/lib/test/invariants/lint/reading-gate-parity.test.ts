/**
 * G4.19 — every dispatcher construction site reaches the reading gate, by threading
 * `getPresentationMode` to the seam or by carrying a local reading/readOnly guard. A
 * one-arm scan misfires because both are load-bearing; a site with neither silently skips
 * the gate, which shipped at four sites before an e2e caught it. The two schema files
 * that OWN the gate are excluded — they ARE the gate.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

const DISPATCH_TOKENS = [
	'dispatchKeyCommand(',
	'dispatchKindCommand(',
	'getCommand(',
	'runGlobalChord(',
	'runCommandById('
];

// Dispatcher definitions + the post-gate `getCommand(binding.command)` live here.
const GATE_OWNER_FILES = new Set([
	'src/lib/schema/block-commands.ts',
	'src/lib/schema/commands.ts'
]);

// Sites gated by a LOCAL reading/readOnly guard instead of a threaded
// getPresentationMode → the regex the guard must keep present.
const LOCAL_GATE_SITES: Record<string, RegExp> = {
	'src/lib/components/blocks/list/ListItemBlock.svelte': /\breadOnly\b/,
	'src/lib/components/GapCaret.svelte': /if \(isReading\) return/,
	'src/lib/components/editor-root-keydown.ts': /=== 'reading'/,
	'src/lib/editor-actions/container-block-component.ts': /isReading\s*\(/,
	// The runCommand door passes a named context rather than a literal; the mode getter is
	// inside it.
	'src/lib/components/Editor.svelte': /getPresentationMode: \(\) => effectiveMode/
};

// Set equality trips the day a new editable surface is born — the dominant future-site
// risk, since a new block kind is a new component file.
const DISPATCH_SITE_FILES = [
	'src/lib/components/blocks/editable-leaf.ts',
	'src/lib/components/blocks/ThematicBreakBlock.svelte',
	'src/lib/components/blocks/code/CodeBlock.svelte',
	'src/lib/components/blocks/text/TextEditableBlock.svelte',
	'src/lib/components/blocks/table/TableCellBlock.svelte',
	'src/lib/editor-actions/plugin/container.ts',
	'src/lib/editor-actions/container-block-component.ts',
	'src/lib/selection/cross-block/keydown.ts',
	'src/lib/components/blocks/list/ListItemBlock.svelte',
	'src/lib/components/editor-root-keydown.ts',
	'src/lib/components/GapCaret.svelte',
	'src/lib/components/Editor.svelte'
];

/** Balanced-paren argument substring of the call whose opening `(` is at `openIdx`. */
function callArgs(code: string, openIdx: number): string {
	let depth = 0;
	for (let i = openIdx; i < code.length; i++) {
		if (code[i] === '(') depth++;
		else if (code[i] === ')' && --depth === 0) return code.slice(openIdx + 1, i);
	}
	return code.slice(openIdx + 1);
}

interface DispatchSite {
	relPath: string;
	args: string;
}

function collectDispatchSites(): DispatchSite[] {
	const sites: DispatchSite[] = [];
	for (const file of collectEditorSources()) {
		if (GATE_OWNER_FILES.has(file.relPath)) continue;
		for (const token of DISPATCH_TOKENS) {
			let from = 0;
			for (;;) {
				const at = file.code.indexOf(token, from);
				if (at < 0) break;
				sites.push({ relPath: file.relPath, args: callArgs(file.code, at + token.length - 1) });
				from = at + token.length;
			}
		}
	}
	return sites;
}

const isThreaded = (args: string): boolean => args.includes('getPresentationMode');

describe('G4.19 reading-gate two-arm parity guard', () => {
	const codeByPath = new Map(collectEditorSources().map((f) => [f.relPath, f.code]));
	const sites = collectDispatchSites();
	const hasLocalGate = (relPath: string): boolean =>
		LOCAL_GATE_SITES[relPath]?.test(codeByPath.get(relPath) ?? '') ?? false;

	it('found dispatch sites to inspect', () => {
		expect(sites.length).toBeGreaterThan(0);
	});

	it('every command-dispatch site threads getPresentationMode or carries a local reading gate', () => {
		const ungated = sites.filter((s) => !isThreaded(s.args) && !hasLocalGate(s.relPath));
		expect(ungated.map((s) => s.relPath)).toEqual([]);
	});

	it('the set of dispatch-site files matches the allowlist (a new surface trips this)', () => {
		const files = [...new Set(sites.map((s) => s.relPath))].sort();
		expect(files).toEqual([...DISPATCH_SITE_FILES].sort());
	});

	it('every local-gate entry genuinely needs its gate (no dead allowlist entry)', () => {
		for (const [relPath, re] of Object.entries(LOCAL_GATE_SITES)) {
			const fileSites = sites.filter((s) => s.relPath === relPath);
			expect(fileSites.length, `no dispatch site in ${relPath}`).toBeGreaterThan(0);
			expect(
				fileSites.some((s) => !isThreaded(s.args)),
				`${relPath} threads every site — its local-gate entry is dead`
			).toBe(true);
			expect(re.test(codeByPath.get(relPath) ?? ''), `gate regex missing in ${relPath}`).toBe(true);
		}
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('callArgs returns the balanced argument list, nested parens included', () => {
		const code = 'dispatchKeyCommand(chord, ctx(), { getPresentationMode })';
		expect(callArgs(code, 'dispatchKeyCommand'.length)).toBe(
			'chord, ctx(), { getPresentationMode }'
		);
	});

	it('threaded detection keys on getPresentationMode presence', () => {
		expect(isThreaded('chord, target, { history, getPresentationMode }')).toBe(true);
		expect(isThreaded('chord, target, { history, pluginEditor }')).toBe(false);
	});

	it('each local-gate regex matches its guard and rejects unrelated text', () => {
		expect(
			LOCAL_GATE_SITES['src/lib/components/blocks/list/ListItemBlock.svelte'].test(
				'if (readOnly) return;'
			)
		).toBe(true);
		expect(
			LOCAL_GATE_SITES['src/lib/components/editor-root-keydown.ts'].test(
				"if (deps.mode === 'reading') return;"
			)
		).toBe(true);
		expect(
			LOCAL_GATE_SITES['src/lib/editor-actions/container-block-component.ts'].test(
				'if (deps.isReading()) return true;'
			)
		).toBe(true);
		expect(
			LOCAL_GATE_SITES['src/lib/components/Editor.svelte'].test(
				'getPresentationMode: () => effectiveMode,'
			)
		).toBe(true);
		expect(
			LOCAL_GATE_SITES['src/lib/components/editor-root-keydown.ts'].test(
				'const mode = readingMode;'
			)
		).toBe(false);
	});
});
