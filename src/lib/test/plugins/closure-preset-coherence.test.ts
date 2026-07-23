import { describe, expect, it, beforeEach } from 'vitest';
import { declaredPluginKind } from '$lib/plugin';
import { checkClosureCoherence, type ClosureCoherenceEntry } from '$lib/invariants/registry';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerTocBlock, TOC_BLOCK } from '$lib/plugins/toc/toc-plugin';
import { registerMathBlock, MATH_BLOCK, MATH_FENCE } from '$lib/plugins/latex/latex-kind';
import { registerMemoBlock, MEMO_BLOCK } from '../../../routes/test/plugins/memo/memo-kind';

// The leaves built on simpleLeafClosure. Their real registered descriptors must
// satisfy G1.24 — a migration that produced an incoherent block (a container
// contract slipped in, the not-mergeable mergeBackspace downgraded) fails here at
// install, not at the next bootstrap flush.
const MIGRATED: { kind: string; install: () => void }[] = [
	{ kind: TOC_BLOCK, install: registerTocBlock },
	{ kind: MATH_BLOCK, install: registerMathBlock },
	{ kind: MATH_FENCE, install: registerMathBlock },
	{ kind: MEMO_BLOCK, install: registerMemoBlock }
];

describe('simpleLeafClosure migrations stay closure-coherent', () => {
	beforeEach(() => resetPluginPlatformForTests());

	it.each(MIGRATED)('$kind passes G1.24 as registered', ({ kind, install }) => {
		install();
		const k = declaredPluginKind(kind);
		const d = getBlockKindDescriptor(k);
		const entry: ClosureCoherenceEntry = {
			kind: k,
			notMergeable: d.mergeRole === 'not-mergeable',
			hasContainerContract: d.containerContract !== undefined,
			roundTripMode: d.closure.roundTrip.mode,
			mergeBackspaceMode: d.closure.mergeBackspace.mode
		};
		expect(checkClosureCoherence([entry])).toBeNull();
	});
});
