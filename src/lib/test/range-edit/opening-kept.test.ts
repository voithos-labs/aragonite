// @vitest-environment jsdom
// Miss-analysis: the container rows started a range in a `:::` row, whose own write keeps its
// marker, or above a `<details>`, never at the first byte of a `<details>`, whose opening no write holds.
import { describe, expect, it } from 'vitest';
import { removalOf } from '#lib/range-edit/edit-range.js';
import type { Mode } from '#lib/range-edit/host.js';
import { checkHost } from './test-host';

const D = '<details open>\n<summary>D</summary>\n\nx\n</details>\n';
const QD = '> <details open>\n> <summary>D</summary>\n>\n> x\n> </details>\n';
const LD = '- <details open>\n  <summary>D</summary>\n\n  x\n  </details>\n';

describe("a range from a container's first byte into its body keeps the opening", () => {
	for (const mode of ['live', 'source'] as Mode[]) {
		it.each([
			['a details', D, D.indexOf('x') + 1, '<details open>\n<summary></summary>\n\n</details>\n'],
			[
				'a details in a quote',
				QD,
				QD.indexOf('x') + 1,
				'> <details open>\n> <summary></summary>\n> \n> </details>\n'
			],
			[
				'a details in a list item',
				LD,
				LD.indexOf('x') + 1,
				'- <details open>\n  <summary></summary>\n  \n  </details>\n'
			]
		])(`%s, ${mode}`, (_, source, to, left) => {
			expect(removalOf(source, { from: 0, to }, 'backspace', mode, checkHost()).source).toBe(left);
		});

		// Controls: a range that stays on a `:::` row, or starts on its marker and runs off it. The
		// row whole is its title in live mode (`title-row-drawn.test.ts`).
		const row = mode === 'live' ? ':::tip \nbody\n:::\n' : '\nbody\n:::\n';
		it.each([
			['the marker alone', ':::tip Title\nbody\n:::\n', 0, 7, 'Title\nbody\n:::\n'],
			['the row whole', ':::tip Title\nbody\n:::\n', 0, 12, row],
			['the row and the body', ':::tip Title\nbody\n:::\n', 0, 17, ':::tip \n\n:::\n']
		])(`a callout, %s, ${mode}`, (_, source, from, to, left) => {
			expect(removalOf(source, { from, to }, 'backspace', mode, checkHost()).source).toBe(left);
		});
	}
});
