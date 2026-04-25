import { describe, it, expect } from 'vitest';
import { HTML5_NAMED_ENTITIES } from '../../../core/inline/html-entities';

describe('HTML5_NAMED_ENTITIES', () => {
	it('decodes representative named entities', () => {
		expect(HTML5_NAMED_ENTITIES.copy).toBe('©');
		expect(HTML5_NAMED_ENTITIES.amp).toBe('&');
		expect(HTML5_NAMED_ENTITIES.lt).toBe('<');
		expect(HTML5_NAMED_ENTITIES.gt).toBe('>');
		expect(HTML5_NAMED_ENTITIES.nbsp).toBe(String.fromCharCode(0xa0));
		expect(HTML5_NAMED_ENTITIES.mdash).toBe('—');
	});

	it('is case-sensitive', () => {
		expect(HTML5_NAMED_ENTITIES.Aacute).toBe('Á');
		expect(HTML5_NAMED_ENTITIES.aacute).toBe('á');
		expect(HTML5_NAMED_ENTITIES.Aacute).not.toBe(HTML5_NAMED_ENTITIES.aacute);
	});

	it('contains a reasonable number of entries', () => {
		const count = Object.keys(HTML5_NAMED_ENTITIES).length;
		expect(count).toBeGreaterThan(2000);
		expect(count).toBeLessThan(2500);
	});

	it('keys do not include the leading & or trailing ;', () => {
		const samples = ['copy', 'amp', 'Aacute'];
		for (const s of samples) {
			expect(HTML5_NAMED_ENTITIES).toHaveProperty(s);
		}
		expect(HTML5_NAMED_ENTITIES).not.toHaveProperty('&copy;');
	});
});
