// Miss-analysis: the kit's terminator cell reached only the two containers whose bodies are real
// children, and its declaration probe asserted a body child outright — so the one shipped shape it
// could not admit (childless, body in metadata) was also the one shape with no other home for the
// collision class, and the reference plugin container went unenrolled.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	augmentBlockKind,
	declaredPluginKind,
	setPluginMetadata,
	getPluginMetadata
} from '$lib/plugin';
import {
	resetPluginPlatformForTests,
	runContainerConformance,
	type ContainerConformanceProfile
} from '$lib/testing';
import {
	registerMermaidKind,
	MERMAID,
	type MermaidMetadata
} from '$lib/plugins/mermaid/mermaid-kind';

const MERMAID_KIND = () => declaredPluginKind(MERMAID);

const CHILDLESS =
	'the diagram is metadata behind a fence, so this container has no child scopes at all — no ' +
	'local index to address, no ancestry to rebuild through, and no child to bubble focus from';

const mermaidProfile: ContainerConformanceProfile = {
	deepNesting: { source: '```mermaid\ngraph TD\n```\n', leafPath: [0] },
	terminatorCollisionFixture: {
		source: '```mermaid\ngraph TD\n```\n',
		bodyRaw: 'graph TD\n```\nafter\n',
		// The body lives in typed metadata, so the kit's write reaches it through the same
		// shallow merge the edit textarea's commit does.
		writeBody: (node, body) => {
			const meta = getPluginMetadata<MermaidMetadata>(node);
			setPluginMetadata<MermaidMetadata>(node, { ...meta!, code: body });
		}
	},
	localIndex: { mode: 'exempt', reason: CHILDLESS },
	ancestry: { mode: 'exempt', reason: CHILDLESS },
	multiScope: { mode: 'exempt', reason: CHILDLESS },
	focusBubble: { mode: 'exempt', reason: CHILDLESS },
	terminatorCollision: { mode: 'assert' }
};

describe('G4.3 conformance kit — the childless opaque container', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerMermaidKind();
	});

	it('runs the kit over mermaid, asserting the one cell its shape can answer', async () => {
		const report = await runContainerConformance(MERMAID_KIND(), mermaidProfile);

		expect(report.kind).toBe(MERMAID);
		expect(report.cells.filter((c) => c.status === 'asserted').map((c) => c.cell)).toEqual([
			'terminatorCollision',
			'declarations'
		]);
	});

	// Non-vacuity: the cell has to see THIS container's collision, not merely pass over a write
	// that never reached its bytes.
	it('fails the terminator cell when the fixture seats the body nowhere', async () => {
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

	// The hole the enrolment found: the declaration probe demanded a body child, so this shape
	// could never reach `declarations` at all, whatever else its profile claimed.
	it('fails declaration sanity when a childless container declares a body wrap', async () => {
		augmentBlockKind(MERMAID_KIND(), { container: { bodyWrap: { afterOpenerLine: true } } });

		await expect(runContainerConformance(MERMAID_KIND(), mermaidProfile)).rejects.toThrow(
			/declarations: mermaid parses childless/
		);
	});
});
