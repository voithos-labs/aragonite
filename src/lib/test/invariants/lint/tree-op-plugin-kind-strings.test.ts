/**
 * G4.x — no plugin kind name in a core dispatch layer. `editor.md` §16 lesson 4
 * forbids core code branching on a specific kind NAME; the enforcement ladder says
 * that coupling must climb off the "documented" rung. A `githubAlert` string once
 * lived in a `tree-operations/` Set beside `blockquote` (the quote-unwrap
 * discriminator), re-derived at the descriptor capability instead. This is the
 * source-scan guard that fails the day a plugin block-kind literal reappears in a
 * dispatch layer, instead of at the next audit.
 *
 * Scope covers the layers where the 0.9.35 strip-container parity sweep found the
 * blockquote-hardcoded sibling paths — `tree-operations/`, `editor-actions/` and
 * `selection/` (the reorder rebuild and the clipboard prefix recovery lived in the
 * latter two, unguarded by the tree-operations-only original scope).
 *
 * Miss-analysis (the coupling that shipped): the dispatch read correctly and every
 * behavioral test passed, so nothing flagged the DIRECTIONAL smell of core naming a
 * plugin kind. No guard scanned the layer for plugin kind strings — this is it.
 *
 * The forbidden set is derived, not hardcoded: every literal a first-party plugin
 * brands via `declarePluginKind` (block kinds; inline kinds are a separate registry
 * that never enters the block tree tree-ops mutate). A new plugin kind joins the set
 * automatically. Built-in kinds (`blockquote`, `list`) are core's own vocabulary and
 * are NOT forbidden — the dispatch legitimately constructs a `blockquote` remainder.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { collectEditorSources, type SourceFile } from './scan-source';

const PLUGIN_SRC = path.resolve('src/lib/plugins');
const DISPATCH_SRCS = [
	path.resolve('src/lib/tree-operations'),
	path.resolve('src/lib/editor-actions'),
	path.resolve('src/lib/selection')
];

// ── Forbidden-set derivation (plugin block-kind literals) ─────────────────────

/** `const NAME = 'value'` / `export const NAME = 'value'` → { NAME: value }. */
function constStringMap(sources: SourceFile[]): Map<string, string> {
	const map = new Map<string, string>();
	const re = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"]*)\2/g;
	for (const f of sources) {
		for (const [, name, , value] of f.code.matchAll(re)) map.set(name, value);
	}
	return map;
}

/**
 * Every literal branded via `declarePluginKind(...)` — a direct string, or an
 * identifier resolved against the plugin sources' const map. `declarePluginInlineKind`
 * is deliberately excluded (inline kinds don't enter the block tree).
 */
function pluginBlockKindLiterals(sources: SourceFile[]): Set<string> {
	const consts = constStringMap(sources);
	const kinds = new Set<string>();
	const re = /(?<!Inline)\bdeclarePluginKind\s*\(\s*(['"]([^'"]*)['"]|[A-Za-z_$][\w$]*)\s*\)/g;
	for (const f of sources) {
		for (const m of f.code.matchAll(re)) {
			const literal = m[2];
			if (literal !== undefined) {
				kinds.add(literal);
				continue;
			}
			const resolved = consts.get(m[1]);
			if (resolved !== undefined) kinds.add(resolved);
		}
	}
	return kinds;
}

/** A kind name used as a quoted string literal in `code`. */
function mentionsAsLiteral(code: string, kind: string): boolean {
	const escaped = kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(['"\`])${escaped}\\1`).test(code);
}

/** `{ file, kinds[] }` for every dispatch source naming a plugin kind. */
function violations(
	sources: SourceFile[],
	forbidden: Set<string>
): Array<{
	file: string;
	kinds: string[];
}> {
	return sources
		.map((f) => ({
			file: f.relPath,
			kinds: [...forbidden].filter((k) => mentionsAsLiteral(f.code, k))
		}))
		.filter((v) => v.kinds.length > 0);
}

// ── The scan ──────────────────────────────────────────────────────────────────

describe('G4.x no plugin kind name in a core dispatch layer', () => {
	const pluginSources = collectEditorSources(PLUGIN_SRC);
	const dispatchSources = DISPATCH_SRCS.flatMap((dir) => collectEditorSources(dir));
	const forbidden = pluginBlockKindLiterals(pluginSources);

	it('derived a non-trivial forbidden set including the known instance', () => {
		expect(forbidden.size).toBeGreaterThan(3);
		expect(forbidden.has('githubAlert')).toBe(true);
		expect(forbidden.has('admonition')).toBe(true);
		// Built-in kinds are core's own vocabulary — never forbidden.
		expect(forbidden.has('blockquote')).toBe(false);
	});

	it('scanned real dispatch sources across all covered layers', () => {
		expect(dispatchSources.length).toBeGreaterThan(0);
		for (const dir of DISPATCH_SRCS) {
			expect(collectEditorSources(dir).length).toBeGreaterThan(0);
		}
	});

	it('no dispatch-layer source names a plugin block kind', () => {
		const found = violations(dispatchSources, forbidden);
		expect(
			found,
			`plugin kind name(s) in a core dispatch layer — route the dispatch through a descriptor capability: ${found
				.map((v) => `${v.file} → ${v.kinds.join(', ')}`)
				.join('; ')}`
		).toEqual([]);
	});
});

// ── Non-vacuity ───────────────────────────────────────────────────────────────

describe('G4.x no plugin kind name in a core dispatch layer — non-vacuity', () => {
	const forbidden = pluginBlockKindLiterals(collectEditorSources(PLUGIN_SRC));

	it('resolves a const-defined plugin kind and a directly-quoted one', () => {
		const sources: SourceFile[] = [
			{ relPath: 'a.ts', text: '', code: "const FOO = 'fooKind';\ndeclarePluginKind(FOO);" },
			{ relPath: 'b.ts', text: '', code: "declarePluginKind('barKind');" }
		];
		const kinds = pluginBlockKindLiterals(sources);
		expect(kinds.has('fooKind')).toBe(true);
		expect(kinds.has('barKind')).toBe(true);
	});

	it('does not brand an inline kind as a block kind', () => {
		const sources: SourceFile[] = [
			{ relPath: 'i.ts', text: '', code: "const EMO = 'emoji';\ndeclarePluginInlineKind(EMO);" }
		];
		expect(pluginBlockKindLiterals(sources).has('emoji')).toBe(false);
	});

	it('catches a planted plugin kind literal in a tree-op source', () => {
		const planted: SourceFile[] = [
			{
				relPath: 'src/lib/tree-operations/blockquote.ts',
				text: '',
				code: "const QUOTE_KINDS = new Set(['blockquote', 'githubAlert']);"
			}
		];
		const found = violations(planted, forbidden);
		expect(found).toEqual([
			{ file: 'src/lib/tree-operations/blockquote.ts', kinds: ['githubAlert'] }
		]);
	});

	it('ignores a plugin kind name that appears only in a comment', () => {
		// scan-source blanks comments to whitespace, so a kind name in prose can't trip.
		const commented: SourceFile[] = [
			{ relPath: 'src/lib/tree-operations/x.ts', text: '', code: '   ' }
		];
		expect(violations(commented, forbidden)).toEqual([]);
	});
});
