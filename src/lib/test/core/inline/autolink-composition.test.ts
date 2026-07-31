import { describe, it, expect } from 'vitest';
import { inlineOf } from './inline-test-helpers';

describe('autolink interactions with other constructs', () => {
	it('autolink does not bleed into a following code span', () => {
		const raw = 'see https://example.com `code` end';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		const codeSpans = nodes.filter((n) => n.kind === 'inlineCode');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com');
		expect(codeSpans).toHaveLength(1);
	});

	it('autolink does not start inside a code span', () => {
		// The code span claims those bytes before the autolink scanner runs.
		const raw = 'pre `https://x.com` post';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		const codeSpans = nodes.filter((n) => n.kind === 'inlineCode');
		expect(autolinks).toHaveLength(0);
		expect(codeSpans).toHaveLength(1);
	});

	it('entity inside angle-bracket inner is not interpreted', () => {
		// The angle scanner regex-tests its sliced inner without re-invoking the entity
		// scanner, so `&copy;` stays literal inside the failed-match angle pair.
		const raw = 'see <foo&copy;bar> end';
		const nodes = inlineOf(raw);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(0);
		const refs = nodes.filter((n) => n.kind === 'entityReference');
		expect(refs).toHaveLength(1);
		expect(refs[0].decoded).toBe('©');
	});
});

describe('parseInline — fast-bail output shape', () => {
	// Both cases open by asserting the autolink is there: without that precondition a
	// degenerate single-text-node output would satisfy both shape checks vacuously.
	it('fast path output has no adjacent text siblings', () => {
		const input = 'before  \nhttps://example.com after';
		const nodes = inlineOf(input);
		expect(nodes.some((n) => n.kind === 'autolink')).toBe(true);
		for (let i = 1; i < nodes.length; i++) {
			const prev = nodes[i - 1];
			const cur = nodes[i];
			if (cur.kind === 'text' && prev.kind === 'text') {
				throw new Error(
					`adjacent text nodes at indices ${i - 1}, ${i}: ${JSON.stringify([prev, cur])}`
				);
			}
		}
	});

	it('fast path: text+autolink+text reconstructs raw', () => {
		const input = 'pre https://example.com post';
		const nodes = inlineOf(input);
		expect(nodes.map((n) => n.kind)).toEqual(['text', 'autolink', 'text']);
		const reconstructed = nodes.map((n) => input.slice(n.start, n.end)).join('');
		expect(reconstructed).toBe(input);
	});
});
