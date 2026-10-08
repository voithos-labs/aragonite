import { describe, expect, it } from 'vitest';
import { declaredPluginKind } from '#lib/plugin.js';
import { checkClosureCoherence } from '#lib/invariants/registry.js';
import { closureCoherenceEntry } from '#lib/schema/registration-checks.js';
import { getBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { registerTocBlock, TOC_BLOCK } from '#lib/plugins/toc/toc-plugin.js';
import { registerMathBlock, MATH_BLOCK, MATH_FENCE } from '#lib/plugins/latex/latex-kind.js';
import { registerMemoBlock, MEMO_BLOCK } from '../../../routes/test/plugins/memo/memo-kind';

// The blocks built on simpleLeafClosure, checked against their registered descriptors so a
// closure that disagrees fails at install time, not at the next render (G1.24).
const MIGRATED: { kind: string; install: () => void }[] = [
	{ kind: TOC_BLOCK, install: registerTocBlock },
	{ kind: MATH_BLOCK, install: registerMathBlock },
	{ kind: MATH_FENCE, install: registerMathBlock },
	{ kind: MEMO_BLOCK, install: registerMemoBlock }
];

describe('simpleLeafClosure migrations stay closure-coherent', () => {
	it.each(MIGRATED)('$kind passes G1.24 as registered', ({ kind, install }) => {
		install();
		const k = declaredPluginKind(kind);
		expect(checkClosureCoherence([closureCoherenceEntry(k, getBlockKindDescriptor(k))])).toBeNull();
	});
});
