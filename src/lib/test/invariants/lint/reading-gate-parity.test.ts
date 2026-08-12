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
	'src/lib/editor-actions/container-block-component.ts': /isReading\s*\(/
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

const GATE_GETTER = 'getPresentationMode';

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

/** The object literal a same-file `const <name> = { … }` binds, braces balanced. */
function namedObjectLiteral(code: string, name: string): string | null {
	const decl = new RegExp(`\\bconst\\s+${name}\\b[^=]*=\\s*\\{`).exec(code);
	if (!decl) return null;
	const open = decl.index + decl[0].length - 1;
	let depth = 0;
	for (let i = open; i < code.length; i++) {
		if (code[i] === '{') depth++;
		else if (code[i] === '}' && --depth === 0) return code.slice(open, i + 1);
	}
	return null;
}

/**
 * True when the site reaches the gate: the getter inline in the argument list, or inside the
 * object literal a bare-identifier argument resolves to. Resolving from the CALL SITE is the
 * point: a door rewired to a context that skips the getter fails, where a file-wide regex for
 * the old context's name would still pass.
 */
function isThreaded(args: string, code: string): boolean {
	if (args.includes(GATE_GETTER)) return true;
	return args
		.split(',')
		.map((arg) => arg.trim())
		.filter((arg) => IDENTIFIER_RE.test(arg))
		.some((name) => namedObjectLiteral(code, name)?.includes(GATE_GETTER) ?? false);
}

describe('G4.19 reading-gate two-arm parity guard', () => {
	const codeByPath = new Map(collectEditorSources().map((f) => [f.relPath, f.code]));
	const codeOf = (relPath: string): string => codeByPath.get(relPath) ?? '';
	const sites = collectDispatchSites();
	const hasLocalGate = (relPath: string): boolean =>
		LOCAL_GATE_SITES[relPath]?.test(codeOf(relPath)) ?? false;

	it('found dispatch sites to inspect', () => {
		expect(sites.length).toBeGreaterThan(0);
	});

	it('every command-dispatch site threads getPresentationMode or carries a local reading gate', () => {
		const ungated = sites.filter(
			(s) => !isThreaded(s.args, codeOf(s.relPath)) && !hasLocalGate(s.relPath)
		);
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
				fileSites.some((s) => !isThreaded(s.args, codeOf(relPath))),
				`${relPath} threads every site — its local-gate entry is dead`
			).toBe(true);
			expect(re.test(codeOf(relPath)), `gate regex missing in ${relPath}`).toBe(true);
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
		expect(isThreaded('chord, target, { history, getPresentationMode }', '')).toBe(true);
		expect(isThreaded('chord, target, { history, pluginEditor }', '')).toBe(false);
	});

	it('a named context argument is threaded only when its own literal carries the getter', () => {
		const gated = 'const ctx = {\n\thistory,\n\tgetPresentationMode: () => effectiveMode\n};';
		const ungated = 'const other = {\n\thistory,\n\tpluginEditor\n};';
		expect(isThreaded('id, undefined, target(), ctx, sink', gated)).toBe(true);
		expect(isThreaded('id, undefined, target(), other, sink', ungated)).toBe(false);
		// The door rewired to a context that skips the gate: the gated const still exists in the
		// file, so a file-wide name regex would pass here.
		expect(isThreaded('id, undefined, target(), other, sink', `${gated}\n${ungated}`)).toBe(false);
	});

	// Non-vacuity for the arm itself: the real door site carries no inline getter, so the whole
	// file rests on the named-context resolution above.
	it('the runCommand door reaches the gate through its named context, not inline', () => {
		const doorSites = sites.filter((s) => s.relPath === 'src/lib/components/Editor.svelte');
		expect(doorSites.length).toBe(1);
		expect(doorSites[0].args.includes(GATE_GETTER)).toBe(false);
		expect(isThreaded(doorSites[0].args, codeOf('src/lib/components/Editor.svelte'))).toBe(true);
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
			LOCAL_GATE_SITES['src/lib/components/editor-root-keydown.ts'].test(
				'const mode = readingMode;'
			)
		).toBe(false);
	});
});
