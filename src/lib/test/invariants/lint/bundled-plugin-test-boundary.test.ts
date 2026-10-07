/**
 * A file under a per-plugin test directory imports from aragonite only what an outside author
 * could (G4.63): the published entry points, the plugin's own source, another plugin's published
 * subpath, the copyable in-repo test support, and relative paths outside library code. An
 * allowlist entry names the public entry point that does not exist yet.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
	aliasPath,
	bundledPluginDirs,
	collectEditorSources,
	importSpecifiers,
	isAliasSpelling,
	publishedEntrySources,
	resolveSpecifier
} from './scan-source';
import { SOURCE_DIR } from './source-paths';

const PLUGIN_TEST_ROOT = SOURCE_DIR.pluginTests;

interface Exemption {
	/** The exact specifiers this file may still reach for. */
	specifiers: string[];
	/** The public entry point that does not exist yet, which is why the reach-in stands. */
	reason: string;
}

/** Publishing the entry point an entry waits on empties that entry, and a dead one fails below. */
const ALLOWLIST: Record<string, Exemption> = {
	'src/lib/test/plugins/admonitions/blockquote-indent-cap.test.ts': {
		specifiers: ['#lib/schema/block-kind-descriptor.js'],
		reason: 'no registry read-back: a kind can be registered and probed, never read back'
	},
	'src/lib/test/plugins/admonitions/fence-escalation.test.ts': {
		specifiers: [
			'#lib/schema/block-kind-descriptor.js',
			'#lib/invariants/node-shape.js',
			'#lib/tree-operations/sharing.js',
			'#lib/tree-operations/chain-rebuild.js'
		],
		reason:
			'no registry read-back, the opaque stale-raw / rebuild-determinism predicates are off the ' +
			'testing barrel (only checkCopyIsRawByteSlice is published), and nothing published runs ' +
			'the ancestor rebuild a commit runs over a parsed document'
	},
	'src/lib/test/plugins/admonitions/formation-harness.ts': {
		specifiers: [
			'#lib/editor-actions/commit/undo-controller.js',
			'#lib/editor-actions/commit/history.js',
			'#lib/editor-actions/container-edit.js',
			'#lib/editor-actions/nested/nested-actions.js',
			'#lib/reactivity/block-list-state.svelte.js'
		],
		reason:
			'no headless editor-actions environment on the testing barrel: the conformance kits ' +
			'build one internally, an author outside the repo cannot'
	},
	'src/lib/test/plugins/admonitions/github-alert-empty-body.test.ts': {
		specifiers: [
			'#lib/tree-operations/index.js',
			'#lib/tree-operations/sharing.js',
			'#lib/invariants/node-shape.js'
		],
		reason:
			'nothing published mutates a parsed document off an instance (nor makes the sharing state ' +
			'that write takes), and the stale-raw predicate is off the testing barrel'
	},
	'src/lib/test/plugins/admonitions/github-alert-formation-siblings.test.ts': {
		specifiers: [
			'#lib/editor-actions/block-edit.js',
			'#lib/editor-actions/commit/undo-controller.js',
			'#lib/testing/parse-convergence.js'
		],
		reason:
			'no headless editor-actions environment, and parse convergence lives in src/lib/testing ' +
			'without reaching the testing barrel'
	},
	'src/lib/test/plugins/admonitions/github-alert-typed-formation.test.ts': {
		specifiers: [
			'#lib/editor-actions/block-edit.js',
			'#lib/editor-actions/commit/undo-controller.js',
			'#lib/testing/parse-convergence.js',
			'#lib/tree-operations/index.js'
		],
		reason:
			'no headless editor-actions environment, no published parse convergence, and nothing published ' +
			'reads a node by path out of a parsed document'
	},
	'src/lib/test/plugins/admonitions/github-alert-unwrap.test.ts': {
		specifiers: ['#lib/tree-operations/index.js', '#lib/schema/block-openers.js'],
		reason:
			'nothing published unwraps a child from its quote off a parsed document, or names the grammar the unwrap reads its remainder with'
	},
	'src/lib/test/plugins/details/terminator-collision.test.ts': {
		specifiers: [
			'#lib/editor-actions/commit/undo-controller.js',
			'#lib/editor-actions/container-edit.js',
			'#lib/editor-actions/nested/nested-actions.js',
			'#lib/reactivity/block-list-state.svelte.js',
			'#lib/invariants/node-shape.js',
			'#lib/schema/block-kind-descriptor.js'
		],
		reason:
			'no headless editor-actions environment, no published opaque stale-raw predicate, and ' +
			'no registry read-back'
	},
	'src/lib/test/plugins/details/terminator-collision-paste.test.ts': {
		specifiers: [
			'#lib/editor-actions/commit/undo-controller.js',
			'#lib/editor-actions/paste-coordinator.js',
			'#lib/invariants/node-shape.js',
			'#lib/reactivity/state-registry.js',
			'#lib/schema/block-openers.js',
			'#lib/tree-operations/paste/dispatch.js'
		],
		reason:
			'the paste pipeline publishes applyPasteTransforms alone: no dispatch, and no headless ' +
			'environment to run it against'
	},
	'src/lib/test/plugins/details/terminator-collision-structural.test.ts': {
		specifiers: [
			'#lib/invariants/node-shape.js',
			'#lib/selection/range-delete.js',
			'#lib/selection/range-coverage.js',
			'#lib/tree-operations/node-ops.js',
			'#lib/tree-operations/sharing.js'
		],
		reason:
			'nothing published splits, joins or range-deletes a parsed document, and no published opaque ' +
			'stale-raw predicate to hold the result to'
	},
	'src/lib/test/plugins/emoji/coexistence.test.ts': {
		specifiers: ['#lib/core/directive/kinds.js'],
		reason:
			'the directive inline level has no published kind name; the plugin barrel publishes the ' +
			'body wrap and the registration entry points only'
	},
	'src/lib/test/plugins/emoji/widget.test.ts': {
		specifiers: ['#lib/core/inline/inline-widgets.js', '#lib/schema/block-openers.js'],
		reason:
			'no registry read-back: a widget kind registers its editing policy but never reads it, ' +
			'and the read takes a grammar no entry point publishes'
	},
	'src/lib/test/plugins/footnotes/definition-split-separator.test.ts': {
		specifiers: [
			'#lib/tree-operations/index.js',
			'#lib/tree-operations/sharing.js',
			'#lib/testing/parse-convergence.js'
		],
		reason:
			'nothing published splits a parsed document (nor makes the sharing state the split takes), ' +
			'and no published parse convergence'
	},
	'src/lib/test/plugins/footnotes/numbering-incremental.test.ts': {
		specifiers: [
			'#lib/editor-actions/block-edit.js',
			'#lib/editor-actions/commit/undo-controller.js',
			'#lib/perf/instruments.js',
			'#lib/schema/container-raw.js'
		],
		reason:
			'no headless editor-actions environment, no published ancestry rebuild, and the perf ' +
			'instruments a plugin proves its own memoization with are unpublished'
	},
	'src/lib/test/plugins/footnotes/reference-shared-walk.test.ts': {
		specifiers: [
			'#lib/perf/instruments.js',
			'#lib/components/blocks/text/TextEditableBlock.svelte'
		],
		reason:
			'the perf instruments are unpublished, and so is the built-in text surface a widget ' +
			'renders into'
	},
	'src/lib/test/plugins/footnotes/reference.test.ts': {
		specifiers: ['#lib/core/inline/inline-widgets.js', '#lib/schema/block-openers.js'],
		reason:
			'no registry read-back: a widget kind registers its component but never reads it, and ' +
			'the read takes a grammar no entry point publishes'
	},
	'src/lib/test/plugins/highlight-occurrences/wiring.test.ts': {
		specifiers: ['#lib/schema/plugin-install.js'],
		reason:
			'no registry read-back: `onEditor` callbacks can be registered but not enumerated, so a ' +
			'per-instance wiring test cannot run one without mounting an editor'
	},
	'src/lib/test/plugins/latex/block.test.ts': {
		specifiers: ['#lib/core/inline/scan/plugin-syntax.js'],
		reason:
			'no registry read-back: an inline syntax handler registers on a trigger but is never listed back'
	},
	'src/lib/test/plugins/latex/inline.test.ts': {
		specifiers: ['#lib/core/inline/inline-widgets.js', '#lib/schema/block-openers.js'],
		reason:
			'no registry read-back for a widget kind, no published core widget shell builder, and ' +
			'no published grammar for either read'
	},
	'src/lib/test/plugins/latex/raw-write-rule.test.ts': {
		specifiers: ['#lib/tree-operations/node-primitives.js', '#lib/schema/block-kind-descriptor.js'],
		reason:
			'a kind declares rawWrite but nothing published applies one, so an author cannot ' +
			'check what their rule makes of bytes a tree operation wrote, nor read the rule back'
	},
	'src/lib/test/plugins/latex/math-shape.property.test.ts': {
		specifiers: [
			'#lib/tree-operations/content-write.js',
			'#lib/test/invariants/arbitraries/property-seed.js'
		],
		reason:
			'nothing published applies a rawWrite the way a leaf commit does (an authored write), and ' +
			'the fixed property seed is the suite’s own helper, with no published counterpart'
	},
	'src/lib/test/plugins/latex/offset-audit.test.ts': {
		specifiers: ['#lib/cursor/widget-offset.js'],
		reason: "no published read of an inline node's raw text out of its parent's bytes"
	},
	'src/lib/test/plugins/latex/typed-completion.test.ts': {
		specifiers: [
			'#lib/editor-actions/enter-completion.js',
			'#lib/schema/block-completions.js',
			'#lib/schema/block-openers.js'
		],
		reason:
			'a completer registers but nothing published runs one, and the Enter handler that consults ' +
			'it has no headless entry, nor a published grammar to run it under'
	},
	'src/lib/test/plugins/mermaid/fence-escalation.test.ts': {
		specifiers: ['#lib/testing/parse-convergence.js'],
		reason: 'parse convergence lives in src/lib/testing without reaching the testing barrel'
	},
	'src/lib/test/plugins/mermaid/raw-write-rule.test.ts': {
		specifiers: [
			'#lib/tree-operations/node-primitives.js',
			'#lib/selection/range-delete.js',
			'#lib/selection/range-coverage.js',
			'#lib/tree-operations/sharing.js'
		],
		reason: 'nothing published applies a kind’s rawWrite or range-deletes a parsed document'
	},
	'src/lib/test/plugins/parrot/caption.test.ts': {
		specifiers: ['#lib/schema/block-kind-descriptor.js'],
		reason: "no registry read-back: the kind's caretTargetAtPoint cannot be read back to call"
	},
	'src/lib/test/plugins/slash-commands/slash-harness.ts': {
		specifiers: [
			'#lib/editor-events.js',
			'#lib/inline-menu/inline-menu-state.svelte.js',
			'#lib/schema/insert-catalogue.js',
			'#lib/schema/plugin-activation.js',
			'#lib/schema/plugin-editor-context.js',
			'#lib/schema/plugin-install.js'
		],
		reason:
			'no headless inline-menu session on the testing barrel: a source can be called directly, ' +
			'but typing a trigger and the write a pick makes need the menu state of the editor itself; ' +
			'only a mounted editor or a plugin context lists the insert catalogue, and only a headless ' +
			"editor context merges an entry's options over the defaults"
	},
	'src/lib/test/plugins/slash-commands/open-command.test.ts': {
		specifiers: [
			'#lib/schema/commands.js',
			'#lib/schema/keybindings.js',
			'#lib/schema/plugin-activation.js'
		],
		reason:
			'no command dispatch or chord read off a mounted editor: the handler of a global command, ' +
			'its chord binding and the activation it resolves under are reachable only through the schema registries'
	}
};

// ── The published API ────────────────────────────────────────────────────────

const PUBLISHED_ENTRIES = publishedEntrySources();

const BUNDLED_PLUGINS = new Set(bundledPluginDirs());

/** The plugin whose suite `relPath` belongs to, or null for a platform test sitting loose
 *  under the test root. */
function suiteOf(relPath: string): string | null {
	if (!relPath.startsWith(PLUGIN_TEST_ROOT)) return null;
	const name = relPath.slice(PLUGIN_TEST_ROOT.length).split('/')[0];
	return BUNDLED_PLUGINS.has(name) ? name : null;
}

function isAllowedSpecifier(relPath: string, specifier: string): boolean {
	// A relative path into library code would get around every rule below.
	if (specifier.startsWith('.')) {
		const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), specifier));
		return !resolved.startsWith(SOURCE_DIR.library) || resolved.startsWith(SOURCE_DIR.unitTests);
	}
	if (!isAliasSpelling(specifier)) return true;
	const target = aliasPath(specifier);
	if (target === null) return false;
	if (PUBLISHED_ENTRIES.has(resolveSpecifier(relPath, specifier) ?? '')) return true;
	if (target.startsWith(SOURCE_DIR.testSupport) || target.startsWith(SOURCE_DIR.testHarness)) {
		return true;
	}
	const suite = suiteOf(relPath);
	return suite !== null && target.startsWith(`${SOURCE_DIR.plugins}${suite}/`);
}

interface Reach {
	relPath: string;
	specifier: string;
}

function reachIns(sources: ReturnType<typeof collectEditorSources>): Reach[] {
	const out: Reach[] = [];
	for (const file of sources) {
		if (suiteOf(file.relPath) === null) continue;
		for (const { specifier } of importSpecifiers(file.code)) {
			if (!isAllowedSpecifier(file.relPath, specifier)) {
				out.push({ relPath: file.relPath, specifier });
			}
		}
	}
	return out;
}

// ── The boundary scan ────────────────────────────────────────────────────────

describe('G4.63 bundled-plugin test boundary', () => {
	const sources = collectEditorSources(path.resolve(PLUGIN_TEST_ROOT));

	it('collected the per-plugin suites', () => {
		const suites = new Set(sources.map((f) => suiteOf(f.relPath)).filter((s) => s !== null));
		expect(suites.size).toBeGreaterThan(1);
	});

	it('every reach-in past the published surface is an allowlisted missing entry point', () => {
		const violations = reachIns(sources).filter(
			(hit) => !ALLOWLIST[hit.relPath]?.specifiers.includes(hit.specifier)
		);
		expect(
			violations,
			`per-plugin suites reaching past the published entry points: ${violations
				.map((v) => `${v.relPath}: ${v.specifier}`)
				.join(', ')}`
		).toEqual([]);
	});

	it('every allowlisted specifier is still imported (no dead allowlist)', () => {
		const live = new Set(reachIns(sources).map((hit) => `${hit.relPath}::${hit.specifier}`));
		const dead: string[] = [];
		for (const [relPath, exemption] of Object.entries(ALLOWLIST)) {
			for (const specifier of exemption.specifiers) {
				if (!live.has(`${relPath}::${specifier}`)) dead.push(`${relPath}: ${specifier}`);
			}
		}
		expect(dead, `allowlist entries with no live import: ${dead.join(', ')}`).toEqual([]);
	});

	it('every allowlist entry names the missing entry point', () => {
		for (const [relPath, exemption] of Object.entries(ALLOWLIST)) {
			expect(exemption.specifiers.length, relPath).toBeGreaterThan(0);
			expect(exemption.reason.length, relPath).toBeGreaterThan(20);
		}
	});
});

// ── Classifier self-tests (non-vacuity) ──────────────────────────────────────

describe('G4.63 classifier non-vacuity', () => {
	const file = `${PLUGIN_TEST_ROOT}details/round-trip.test.ts`;

	it('allows the three published entry points', () => {
		for (const barrel of ['#lib', '#lib/plugin.js', '#lib/testing.js']) {
			expect(isAllowedSpecifier(file, barrel)).toBe(true);
		}
	});

	it('rejects every deep #lib reach-in a rewrite is supposed to remove', () => {
		for (const deep of [
			'#lib/core/parser.js',
			'#lib/core/serializer.js',
			'#lib/core/nodes.js',
			'#lib/schema/registry-reset.js',
			'#lib/editor-actions/commit/undo-controller.js'
		]) {
			expect(isAllowedSpecifier(file, deep)).toBe(false);
		}
	});

	it('allows the suite its own plugin source, and another plugin only where published', () => {
		expect(isAllowedSpecifier(file, '#lib/plugins/details/index.js')).toBe(true);
		expect(isAllowedSpecifier(file, '#lib/plugins/details/details-kind.js')).toBe(true);
		expect(isAllowedSpecifier(file, '#lib/plugins/emoji/index.js')).toBe(true);
		expect(isAllowedSpecifier(file, '#lib/plugins/emoji/emoji-recognizer.js')).toBe(false);
	});

	it('allows the copyable test support and any npm package', () => {
		expect(isAllowedSpecifier(file, '#lib/test/support/round-trip.js')).toBe(true);
		expect(isAllowedSpecifier(file, '#lib/test/harness/editor-actions.js')).toBe(true);
		expect(isAllowedSpecifier(file, 'vitest')).toBe(true);
		expect(isAllowedSpecifier(file, 'fast-check')).toBe(true);
		expect(isAllowedSpecifier(file, 'svelte/store')).toBe(true);
		expect(isAllowedSpecifier(file, 'node:fs')).toBe(true);
	});

	it('allows a relative path outside library code, rejects one that reaches into it', () => {
		expect(isAllowedSpecifier(file, './fixtures')).toBe(true);
		expect(isAllowedSpecifier(file, '../../harness/scan-growth')).toBe(true);
		expect(isAllowedSpecifier(file, '../../../../../scripts/build.mjs')).toBe(true);
		expect(isAllowedSpecifier(file, '../../../core/parser')).toBe(false);
		expect(isAllowedSpecifier(file, '../../../plugins/emoji/emoji-recognizer')).toBe(false);
	});

	it('binds per-plugin suites only, leaving the loose platform tests alone', () => {
		expect(suiteOf(`${PLUGIN_TEST_ROOT}details/round-trip.test.ts`)).toBe('details');
		expect(suiteOf(`${PLUGIN_TEST_ROOT}kind-conformance.test.ts`)).toBe(null);
		expect(suiteOf(`${PLUGIN_TEST_ROOT}fixtures/showcase.ts`)).toBe(null);
	});
});
