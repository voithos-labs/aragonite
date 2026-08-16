import { describe, it, expect, beforeEach } from 'vitest';
import {
	declarePluginKind,
	getPluginMetadata,
	registerBlockKind,
	registerBlockOpener,
	setPluginMetadata,
	OPENER_PRIORITIES,
	type AnyBlockKind,
	type CstNode
} from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import {
	checkTerminatorCollision,
	type ContainerConformanceProfile
} from '$lib/testing/container-conformance';
import { testClosure } from '$lib/test/support/closure';

// The terminator cell over a CHILDLESS container — the whole-block shape (mermaid's) whose body
// lives in metadata, so there is no last child to overwrite. Two kinds share one grammar and
// differ only in whether the rebuild widens its fence past the body, which is the repair the
// cell exists to find.

const OPEN = /^(~{3,})(probe-wide|probe-fixed)$/;

interface ProbeMetadata {
	code: string;
}

const isCloser = (text: string, minimum: number): boolean =>
	/^~+$/.test(text) && text.length >= minimum;

/** One past the longest whole-line tilde run in the body, never below three. */
function escalatedFenceRun(code: string): number {
	let required = 3;
	for (const line of code.split('\n')) {
		if (/^~+$/.test(line)) required = Math.max(required, line.length + 1);
	}
	return required;
}

function registerProbeKind(name: 'probe-wide' | 'probe-fixed'): AnyBlockKind {
	const kind = declarePluginKind(name);
	const rebuildRaw = (node: CstNode): void => {
		const code = getPluginMetadata<ProbeMetadata>(node)?.code ?? '';
		const fence = '~'.repeat(name === 'probe-wide' ? escalatedFenceRun(code) : 3);
		node.raw = `${fence}${name}\n${code}${fence}\n`;
	};

	registerBlockKind(kind, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		container: { contract: 'opaque', rebuildRaw }
	});
	registerBlockOpener(kind, {
		// The built-in fence matcher accepts `~~~` with any info, so this must price ahead of it.
		priority: OPENER_PRIORITIES.fencedCode - 5,
		interruptsParagraph: (line) => OPEN.exec(line)?.[2] === name,
		tryOpen(ctx) {
			const opener = OPEN.exec(ctx.line.text);
			if (opener?.[2] !== name) return null;
			let i = ctx.index + 1;
			while (i < ctx.end && !isCloser(ctx.lines[i].text, opener[1].length)) i++;
			if (i >= ctx.end) return null;

			const node: CstNode = { kind, leadingTrivia: ctx.leadingTrivia, raw: '', children: [] };
			setPluginMetadata<ProbeMetadata>(node, {
				code: ctx.lines
					.slice(ctx.index + 1, i)
					.map((l) => l.raw)
					.join('')
			});
			rebuildRaw(node);
			return { node, consumed: i + 1 - ctx.index };
		}
	});
	return kind;
}

type WriteBody = (node: CstNode, body: string) => void;

const profileFor = (
	name: 'probe-wide' | 'probe-fixed',
	writeBody?: WriteBody
): ContainerConformanceProfile => ({
	deepNesting: { source: `~~~${name}\ndraft\n~~~\n`, leafPath: [0] },
	terminatorCollisionFixture: {
		source: `~~~${name}\ndraft\n~~~\n`,
		bodyRaw: 'before\n~~~\nafter\n',
		writeBody
	},
	localIndex: { mode: 'exempt', reason: 'childless: the whole body is one metadata field' },
	ancestry: { mode: 'exempt', reason: 'childless: the kind can never be an ancestor of a leaf' },
	multiScope: { mode: 'exempt', reason: 'childless: no ≥2-scope op reaches inside the block' },
	focusBubble: { mode: 'exempt', reason: 'childless: focus is whole-block, not inner-index' },
	terminatorCollision: { mode: 'assert' }
});

const seatCode = (node: CstNode, body: string): void =>
	setPluginMetadata<ProbeMetadata>(node, { code: body });

describe('G4.3 terminator collision — the childless, metadata-bodied shape', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
	});

	it('passes a childless container whose rebuild widens its fence past the body', () => {
		const kind = registerProbeKind('probe-wide');
		expect(() => checkTerminatorCollision(kind, profileFor('probe-wide', seatCode))).not.toThrow();
	});

	// Non-vacuity: the same fixture against a rebuild that keeps a fixed fence must be caught,
	// or the childless arm is running the write and asserting nothing about the reparse.
	it('fails a childless container whose fixed fence lets the body close the block', () => {
		const kind = registerProbeKind('probe-fixed');
		expect(() => checkTerminatorCollision(kind, profileFor('probe-fixed', seatCode))).toThrow(
			/survives a body line reproducing its terminator/
		);
	});

	it('refuses a childless fixture that carries no writeBody', () => {
		const kind = registerProbeKind('probe-wide');
		expect(() => checkTerminatorCollision(kind, profileFor('probe-wide'))).toThrow(
			/parses childless, so there is no last child to overwrite/
		);
	});

	// The floor under the whole cell: a write that never reaches the container's bytes would
	// otherwise report a collision survived that the container never saw.
	it('refuses a writeBody that leaves the container’s bytes untouched', () => {
		const kind = registerProbeKind('probe-wide');
		expect(() =>
			checkTerminatorCollision(
				kind,
				profileFor('probe-wide', () => {})
			)
		).toThrow(/the fixture body reached "probe-wide"'s own bytes/);
	});
});
