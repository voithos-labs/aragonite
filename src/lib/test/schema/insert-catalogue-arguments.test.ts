import { describe, expect, it } from 'vitest';
import { insertCatalogue } from '#lib/schema/insert-catalogue.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';

const builtIn = (id: string) => insertCatalogue(everyInstalledPlugin).find((e) => e.id === id)!;

const withArgument = (id: string, argument: string) => builtIn(id).withArgument!(argument);

describe('the table entry', () => {
	it.each(['3X4', '3×4'])('%j reads as 3x4', (size) => {
		expect(withArgument('table', size)).toEqual(withArgument('table', '3x4'));
		expect(withArgument('table', size).detail).toBe('3×4');
	});

	it('2x2 is the entry’s own table', () => {
		expect(withArgument('table', '2x2').markdown).toBe(builtIn('table').markdown);
	});

	it('reads the largest size it allows, 20 columns by 100 rows', () => {
		expect(withArgument('table', '20x100').detail).toBe('20×100');
	});

	it.each(['3', 'x4', '0x4', '3x1', '21x2', '2x101'])(
		'%j inserts the default and says how to write a size',
		(size) => {
			const parsed = withArgument('table', size);
			expect(parsed.markdown).toBe(builtIn('table').markdown);
			expect(parsed.detail).toMatch(/^2×2 · .*3x4/);
		}
	);
});

describe('the code entry', () => {
	it('puts the language on the opening fence', () => {
		expect(withArgument('code', 'js')).toEqual({ markdown: '```js\n\n```\n', detail: 'js' });
	});

	it('drops a backtick the way the code block does: `ja`va` opens a java fence', () => {
		expect(withArgument('code', 'ja`va')).toEqual({ markdown: '```java\n\n```\n', detail: 'java' });
	});

	it('a language of nothing but backticks opens a plain fence and says so', () => {
		expect(withArgument('code', '``')).toEqual({
			markdown: '```\n\n```\n',
			detail: 'no language'
		});
	});
});
