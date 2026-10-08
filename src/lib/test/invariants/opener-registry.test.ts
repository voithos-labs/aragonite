import { describe, expect, it } from 'vitest';
import type { AnyBlockKind } from '#lib/core/nodes.js';
import { checkOpenerRegistry } from '#lib/invariants/registry.js';
import { listRegisteredOpeners } from '#lib/schema/block-openers.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import '#lib/core/parser.js';

const hasRealDescriptor = (kind: AnyBlockKind) => tryGetBlockKindDescriptor(kind) !== undefined;

describe('G1.10 opener-registry coherence', () => {
	it('holds over the real registries once the parser has registered built-ins', () => {
		expect(checkOpenerRegistry(listRegisteredOpeners(), hasRealDescriptor)).toBeNull();
	});

	it('flags an opener whose kind has no descriptor', () => {
		const v = checkOpenerRegistry([{ kind: 'heading', priority: 20 }], () => false);
		expect(v?.code).toBe('opener-registry');
		expect(v?.message).toContain('no descriptor');
	});

	it('flags duplicate priorities', () => {
		const v = checkOpenerRegistry(
			[
				{ kind: 'heading', priority: 20 },
				{ kind: 'blockquote', priority: 20 }
			],
			() => true
		);
		expect(v?.code).toBe('opener-registry');
		expect(v?.message).toContain('priority 20');
	});
});
