/**
 * A kind's own raw-write rule (`normalizeRawWrite`) reaches its bytes through one reader,
 * `writeOwnRaw`, and every sink writing a leaf's raw without the kind's surface or a
 * reparse behind it calls it. Issue #45 was the parity hole: the G4.24 funnel lint pinned
 * the code SURFACE's write sites, so find-and-replace wrote a fence terminator into a code
 * body through a door nothing watched. The site lists below make sink N+1 a decision.
 */

import { describe, it, expect } from 'vitest';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { collectEditorSources, stripComments } from './scan-source';

const SINK = 'src/lib/tree-operations/node-ops.ts';

/** Every file naming the capability in code, and why. */
const CAPABILITY_SITES: Record<string, string> = {
	'src/lib/schema/block-kind-descriptor.ts': 'the field declaration',
	'src/lib/schema/built-in-descriptors.ts': 'tableCell and fencedCode declare it',
	[SINK]: 'the reader dispatches it'
};

/** Every sink that writes a leaf's raw and owes the kind's rule. */
const READER_SITES: Record<string, string> = {
	[SINK]: 'the reader itself, plus the context-dependent-kind write',
	'src/lib/editor-actions/search-replace.ts': 'substitutes into a private clone',
	'src/lib/selection/range-delete.ts': 'the same-block merge writes raw with no reparse',
	'src/lib/selection/cross-block/type-replace.ts': 'the degraded arm splices raw',
	'src/lib/tree-operations/paste/container-match.ts': 'splices clipboard text into the target leaf'
};

/** The fence rule has one implementation, shared by the display funnel and the byte sink. */
const FENCE_HOME = 'src/lib/schema/fenced-code-raw.ts';
const FENCE_READERS: Record<string, string> = {
	[FENCE_HOME]: 'the implementation',
	'src/lib/components/blocks/code/CodeBlock.svelte': 'the display-commit funnel',
	'src/lib/components/blocks/code/code-paste.ts': 'the paste surface'
};

const CAPABILITY = /\bnormalizeRawWrite\b/;
const READER = /\bwriteOwnRaw\b/;

function namesInCode(sources: { relPath: string; code: string }[], re: RegExp): string[] {
	return sources
		.filter((f) => re.test(f.code))
		.map((f) => f.relPath)
		.sort();
}

describe('the kind’s own raw-write rule runs at every byte sink', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it.each(['tableCell', 'fencedCode'] as const)('%s declares the capability', (kind) => {
		expect(typeof getBlockKindDescriptor(kind).normalizeRawWrite).toBe('function');
	});

	it('the reader lives at the sink and dispatches whatever the kind declared', () => {
		const sink = sources.find((f) => f.relPath === SINK);
		expect(sink, `${SINK} not found`).toBeDefined();
		expect(CAPABILITY.test(sink!.code), 'the reader stopped dispatching the capability').toBe(true);
	});

	it('exactly the documented sites name the capability', () => {
		expect(namesInCode(sources, CAPABILITY)).toEqual(Object.keys(CAPABILITY_SITES).sort());
	});

	// Fails when a sink is wired in or unwired, making door N+1 an explicit decision. A bare
	// `.raw =` write never names the reader and still escapes this scan.
	it('exactly the documented sinks call the reader', () => {
		expect(namesInCode(sources, READER)).toEqual(Object.keys(READER_SITES).sort());
	});
});

describe('the fence rule has one implementation', () => {
	const sources = collectEditorSources();

	it('exactly the documented readers name the reconciliation', () => {
		expect(namesInCode(sources, /\breconcileFenceWrite\b/)).toEqual(
			Object.keys(FENCE_READERS).sort()
		);
	});

	it('the escalation primitive is named only by the grammar leaf and the rule', () => {
		expect(namesInCode(sources, /\bescalatedFenceLength\b/)).toEqual([
			'src/lib/core/parsers/fence-syntax.ts',
			FENCE_HOME
		]);
	});

	// The rule reads the block's OWN fence shape, so it must live where a headless sink can
	// reach it: under `components/` it would exist only once the component tree loaded.
	it('the rule home is in schema, importing no component', () => {
		const home = sources.find((f) => f.relPath === FENCE_HOME);
		expect(home, `${FENCE_HOME} not found`).toBeDefined();
		expect(home!.code).not.toMatch(/from\s*['"][^'"]*components/);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('a mention inside a comment cannot satisfy the scan', () => {
		expect(READER.test(stripComments('// calls writeOwnRaw one day\n'))).toBe(false);
		expect(READER.test(stripComments('x = writeOwnRaw(n, r);\n'))).toBe(true);
	});
});
