import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';

// The opener's close-scan must track fenced code in the body: a `</details>` line
// inside a fence is content, not the container's closer, and a fenced `<details>`
// must not inflate the nesting depth. Bytes round-trip either way — the surprise the
// fence-blind scan produced was structural (early close / spurious decline).
function resetAndRegister(): void {
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	registerDetailsKind();
}

describe('details fence-aware close scan', () => {
	beforeEach(resetAndRegister);

	it('does not close early on a fenced </details> in the body', () => {
		const src = '<details>\n<summary>T</summary>\n\n```\n</details>\n```\n\n</details>\n';
		const doc = parse(src);
		expect(doc.children.length).toBe(1);
		expect(doc.children[0].kind).toBe('details');
		expect(doc.children[0].children?.map((c) => c.kind)).toEqual(['details-summary', 'fencedCode']);
		expect(serialize(doc)).toBe(src);
	});

	it('does not inflate the depth on a fenced <details> in the body', () => {
		const src = '<details>\n<summary>T</summary>\n\n```\n<details>\n```\n\n</details>\n';
		const doc = parse(src);
		expect(doc.children.length).toBe(1);
		expect(doc.children[0].kind).toBe('details');
		expect(serialize(doc)).toBe(src);
	});

	it('still round-trips a real nested details (fence tracking leaves genuine nesting alone)', () => {
		const src =
			'<details>\n<summary>Outer</summary>\n\n' +
			'<details>\n<summary>Inner</summary>\n\ninner\n\n</details>\n\n' +
			'</details>\n';
		const doc = parse(src);
		expect(doc.children[0].kind).toBe('details');
		expect(doc.children[0].children?.map((c) => c.kind)).toEqual(['details-summary', 'details']);
		expect(serialize(doc)).toBe(src);
	});
});
