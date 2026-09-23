// The kind kit's raw-write cell: every kind that declares `normalizeRawWrite` has its rule driven
// through truncating writes over its fixture, and a kind without one is exempt.
// Miss-analysis: the rule was pinned only by a scan of where it is declared and read, so a fenced
// leaf whose rule dropped its closer passed every conformance run.
import { describe, it, expect, beforeEach } from 'vitest';
import { declaredPluginKind } from '$lib/plugin';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { normalizeFencedRaw } from '$lib/schema/fenced-code-raw';
import { resetPluginPlatformForTests, runKindConformance } from '$lib/testing';
import { checkLeafRawWrite } from '$lib/testing/kind-conformance';
import { registerMathBlock, MATH_BLOCK, MATH_FENCE } from '$lib/plugins/latex/latex-kind';
import { registerMermaidKind, MERMAID } from '$lib/plugins/mermaid/mermaid-kind';
import type { NodeView } from '$lib/core/node-views';
import type { AnyBlockKind } from '$lib/core/nodes';

beforeEach(() => {
	resetPluginPlatformForTests();
	registerMathBlock();
	registerMermaidKind();
});

describe('kind conformance: the raw-write cell', () => {
	it.each([
		(): AnyBlockKind => 'fencedCode',
		() => declaredPluginKind(MATH_BLOCK),
		() => declaredPluginKind(MATH_FENCE),
		() => declaredPluginKind(MERMAID)
	])('executes for a declaring kind (%#)', async (kindOf) => {
		const report = await runKindConformance(kindOf());
		expect(report.rawWrite.status).toBe('executed');
	});

	it('is exempt for a kind that declares no rule', async () => {
		const report = await runKindConformance('paragraph');
		expect(report.rawWrite.status).toBe('exempt');
	});

	// A declarer the kit has no fixture to write over is recorded, never reported green.
	it('is boundary for a declaring kind with no top-level fixture', async () => {
		const report = await runKindConformance('tableCell');
		expect(report.rawWrite.status).toBe('boundary');
	});
});

describe('kind conformance: the raw-write cell fails a broken rule', () => {
	const fixture = getBlockKindDescriptor('fencedCode').conformanceFixture!;

	it('fails a rule that drops the closer', () => {
		const dropsCloser = (node: NodeView, raw: string) =>
			normalizeFencedRaw(raw, node).replace(/```\n$/, '');
		expect(() => checkLeafRawWrite('fencedCode', fixture, dropsCloser)).toThrow(
			/the closing line cut/
		);
	});

	it('fails a rule that repairs nothing', () => {
		expect(() => checkLeafRawWrite('fencedCode', fixture, (_node, raw) => raw)).toThrow(
			/the closing line cut/
		);
	});

	it('fails a rule that is not idempotent', () => {
		const grows = (_node: NodeView, raw: string) => raw + 'x';
		expect(() => checkLeafRawWrite('fencedCode', fixture, grows)).toThrow(/idempotent/);
	});
});
