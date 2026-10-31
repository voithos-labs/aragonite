// Miss-analysis: no kit cell reached a childless container whose body lives in metadata.
import { describe, it, expect, beforeEach } from 'vitest';
import { augmentBlockKind, declaredPluginKind } from '#lib/plugin.js';
import { runContainerConformance } from '#lib/testing.js';
import { registerMermaidKind, MERMAID } from '#packages/mermaid/src/mermaid-kind.js';
import { mermaidProfile } from '#packages/mermaid/src/conformance.js';
import { testView } from '#lib/test/harness/test-view.js';

const MERMAID_KIND = () => declaredPluginKind(MERMAID);

describe('G4.3 conformance kit: the childless opaque container', () => {
	beforeEach(() => {
		registerMermaidKind(testView());
	});

	it('runs the kit over mermaid, asserting the one cell its shape can answer', async () => {
		const report = await runContainerConformance(MERMAID_KIND(), mermaidProfile);

		expect(report.kind).toBe(MERMAID);
		expect(report.cells.filter((c) => c.status === 'asserted').map((c) => c.cell)).toEqual([
			'terminatorCollision',
			'openerLine',
			'declarations'
		]);
	});

	// Non-vacuity: the cell has to see this container's collision, not simply pass over a write
	// that never reached its bytes.
	it('fails the terminator cell when the fixture puts the caret at the body nowhere', async () => {
		await expect(
			runContainerConformance(MERMAID_KIND(), {
				...mermaidProfile,
				terminatorCollisionFixture: {
					...mermaidProfile.terminatorCollisionFixture!,
					writeBody: () => {}
				}
			})
		).rejects.toThrow(/the fixture body reached "mermaid"'s own bytes/);
	});

	// The declaration check reads a childless container's declarations too, rather than
	// rejecting it for having no body child.
	it('fails declaration sanity when a childless container declares a body wrap', async () => {
		augmentBlockKind(MERMAID_KIND(), { container: { bodyWrap: { afterOpenerLine: true } } });

		await expect(runContainerConformance(MERMAID_KIND(), mermaidProfile)).rejects.toThrow(
			/declarations: mermaid parses childless/
		);
	});
});
