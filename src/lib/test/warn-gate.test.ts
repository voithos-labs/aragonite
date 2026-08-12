// Miss-analysis: devWarn returned early under Vitest, so the guard channel was unobservable.

import { describe, it, expect } from 'vitest';
import { tick } from 'svelte';
import { devWarn, setDevWarnSink } from '$lib/dev-warn';
import {
	takeDevWarns,
	allowDevWarns,
	auditWarnDeclarations,
	enforceWarnGate,
	findUnallowlistedWarns,
	formatWarnFailure,
	formatUndeclaredWarnFailure,
	siteFromStack,
	UNKNOWN_SITE,
	type AllowedWarn,
	type DevWarnRecord
} from './support/warn-gate';
import { reorderChildren } from '$lib/tree-operations/reorder';
import type { CstNode } from '$lib/core/nodes';

const THROWAWAY: AllowedWarn[] = [
	{ tag: 'probe', site: 'src/lib/probe.ts', reason: 'throwaway row for the verdict tests' }
];

function record(tag: string, site: string): DevWarnRecord {
	return { tag, site, message: 'm', details: undefined };
}

describe('warn-gate verdict', () => {
	it('passes a record whose tag and site both match a row', () => {
		expect(findUnallowlistedWarns([record('probe', 'src/lib/probe.ts')], THROWAWAY)).toEqual([]);
	});

	it('fails a matching tag emitted from another file, and a new tag at an allowed file', () => {
		const wrongSite = record('probe', 'src/lib/elsewhere.ts');
		const wrongTag = record('other', 'src/lib/probe.ts');
		expect(findUnallowlistedWarns([wrongSite, wrongTag], THROWAWAY)).toEqual([wrongSite, wrongTag]);
	});

	it('fails everything against an empty allowlist', () => {
		expect(findUnallowlistedWarns([record('probe', 'src/lib/probe.ts')], [])).toHaveLength(1);
	});

	it('names the tag, the site and the message in the failure text', () => {
		const text = formatWarnFailure([{ tag: 'reorder', site: 'src/lib/x.ts', message: 'boom' }]);
		expect(text).toContain('[reorder]');
		expect(text).toContain('src/lib/x.ts');
		expect(text).toContain('boom');
	});

	it('names the declared set beside the fire it failed to cover', () => {
		const text = formatUndeclaredWarnFailure(
			['alpha', 'beta'],
			[{ tag: 'gamma', site: 'src/lib/x.ts', message: 'boom' }]
		);
		expect(text).toContain('declared [alpha, beta]');
		expect(text).toContain('[gamma]');
		expect(text).toContain('src/lib/x.ts');
		expect(text).toContain('boom');
	});
});

describe('warn-gate declared-fire drain', () => {
	it('accepts a declared tag from any site and leaves the sink empty', () => {
		devWarn('probe', 'declared');
		expect(allowDevWarns(['probe'])).toHaveLength(1);
		expect(takeDevWarns()).toEqual([]);
	});

	it('reds the test on a tag the caller did not declare, keeping the declared one', () => {
		devWarn('probe', 'undeclared');
		devWarn('other', 'declared');
		expect(() => allowDevWarns(['other'])).toThrow(/declared \[other\][\s\S]*\[probe\]/);
	});
});

describe('warn-gate site attribution', () => {
	it('skips the relay frames and reports the first emitting src/lib file', () => {
		const stack = [
			'Error',
			'    at listener (C:/a b/repo/src/lib/test/support/warn-gate.ts:70:20)',
			'    at devWarn (C:/a b/repo/src/lib/dev-warn.ts:22:11)',
			'    at assertInvariant (C:/a b/repo/src/lib/invariants/assert.ts:21:3)',
			'    at check (C:/a b/repo/src/lib/tree-operations/node-ops.ts:255:3)'
		].join('\n');
		expect(siteFromStack(stack)).toBe('src/lib/tree-operations/node-ops.ts');
	});

	it('reads a Svelte component frame and a Vite query suffix', () => {
		const svelte = '    at render (C:/repo/src/lib/components/BlockHost.svelte:103:5)';
		expect(siteFromStack(svelte)).toBe('src/lib/components/BlockHost.svelte');
		const queried = '    at f (C:/repo/src/lib/decorations/island-dom.ts?v=abc123:99:4)';
		expect(siteFromStack(queried)).toBe('src/lib/decorations/island-dom.ts');
	});

	it('falls back when no editor frame survives (node internals only)', () => {
		expect(siteFromStack('Error\n    at node:internal/main:1:1')).toBe(UNKNOWN_SITE);
		expect(siteFromStack(undefined)).toBe(UNKNOWN_SITE);
	});
});

describe('warn-gate sink', () => {
	it('records a live fire with its real emitting site, and drains it', () => {
		reorderChildren([{ kind: 'paragraph', raw: 'a' } as CstNode], 0, 9);
		const drained = takeDevWarns();
		expect(drained).toHaveLength(1);
		expect(drained[0].tag).toBe('reorder');
		expect(drained[0].site).toBe('src/lib/tree-operations/reorder.ts');
		expect(takeDevWarns()).toEqual([]);
	});

	it('carries the details payload through the sink', () => {
		devWarn('probe', 'with details', { offset: 3 });
		expect(takeDevWarns()[0].details).toEqual({ offset: 3 });
	});
});

// An unrestored sink swap blinds the gate for the rest of the worker: later fires reach the
// console instead, and every later test passes regardless.
describe('warn-gate sink ownership', () => {
	it('reds the test that stole the sink, and re-arms itself for the next one', async () => {
		const thief: unknown[] = [];
		setDevWarnSink((entry) => thief.push(entry));

		await expect(enforceWarnGate()).rejects.toThrow(/never restored it/);

		devWarn('probe', 'after the re-arm');
		expect(thief, 'the thief stopped receiving fires').toEqual([]);
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['probe']);
	});

	it('stays quiet when the gate still owns the sink', async () => {
		await expect(enforceWarnGate()).resolves.toBeUndefined();
	});
});

// A guard that awaits a tick before warning (`reportContestedClaim`) fires after its own
// test's claim door has run: the verdict ticks first so the fire lands on its own test.
describe('warn-gate deferred fires', () => {
	it('attributes a tick-deferred fire to the test that provoked it', async () => {
		void tick().then(() => devWarn('probe', 'deferred past the claim door'));
		await expect(enforceWarnGate()).rejects.toThrow(/\[probe\]/);
	});
});

describe('warn-gate per-file aggregate', () => {
	const late = (tag: string): DevWarnRecord[] => [
		{ tag, site: 'src/lib/x.ts', message: 'after the last test' }
	];

	it('passes a declaration every one of whose tags fired', () => {
		expect(auditWarnDeclarations(['a', 'b'], new Set(['a', 'b', 'c']), [])).toEqual([]);
	});

	it('names the declared tags that never fired', () => {
		const [problem] = auditWarnDeclarations(['a', 'stale'], new Set(['a']), []);
		expect(problem).toContain('[stale]');
		expect(problem).not.toContain('[a, stale]');
	});

	it('names a fire that outlived every test, tag and site both', () => {
		const [problem] = auditWarnDeclarations([], new Set(['late']), late('late'));
		expect(problem).toContain("after the last test's verdict");
		expect(problem).toContain('[late]');
		expect(problem).toContain('src/lib/x.ts');
	});

	it('reports both holes at once rather than the first', () => {
		expect(auditWarnDeclarations(['stale'], new Set(['late']), late('late'))).toHaveLength(2);
	});
});
