/**
 * `<details>` sections: a `<details>` or `<details open>` line, a `<summary>` line under it, a
 * Markdown body and `</details>`, drawn as a section whose body folds away under its summary.
 * Only that spelling opens one; a tag line a browser would also read (`</DETAILS>`, `<details >`)
 * still pairs inside a body, and the editor escapes one typed there that pairs with nothing.
 */

import { builtin, container, definePlugin, fencedLines } from '@voithos-labs/aragonite/plugin';
import { svelteBlock } from '@voithos-labs/aragonite/svelte';
import DetailsBlock from './DetailsBlock.svelte';

/** A section's data: whether it shows open, which its opening tag writes as `open`. */
export interface DetailsData {
	open: boolean;
}

// A tag line as CommonMark's HTML blocks read one: any case, up to three spaces in, then anything
// after the name. GFM's whitespace, not JavaScript's `\s`.
const TAG_END = '(?=[ \\t\\v\\f\\r/>]|$)';

/** Collapsible `<details>` sections: list `details` in an editor's plugins. */
export const details = definePlugin({
	name: 'details',
	version: '0.11.5',
	editor: '0.11.5',
	contributes: () => ({
		blocks: [
			container<DetailsData>({
				name: 'details',
				label: 'Details',
				dragLabel: 'Details',
				// Ahead of the HTML block, which would take `<details>` as raw HTML.
				before: builtin.blocks.htmlBlock,
				interrupts: true,
				lines: fencedLines<DetailsData>({
					open: new RegExp(`^ {0,3}<details( open)?${TAG_END}`, 'i'),
					data: (match) => ({ open: match[1] !== undefined }),
					write: (data) => (data.open ? '<details open>' : '<details>'),
					title: {
						match: /^<summary>(?<text>.*)<\/summary>$/,
						write: (title) => `<summary>${title}</summary>`,
						label: 'Summary',
						className: 'details-summary'
					},
					close: {
						match: new RegExp(`^ {0,3}</details${TAG_END}`, 'i'),
						write: () => '</details>'
					},
					// A literal `<` in a paragraph, an HTML block and on GitHub alike.
					escape: (line) => line.replace('<', '&lt;')
				}),
				closable: {
					closed: (data) => !data.open,
					set: (data, closed) => ({ ...data, open: !closed })
				},
				sample: '<details>\n<summary>Title</summary>\n\nbody\n\n</details>\n',
				insert: {
					label: 'Details',
					icon: 'list-collapse',
					keywords: ['toggle', 'collapsible', 'disclosure', 'summary', 'expand'],
					insert: '<details>\n<summary></summary>\n\n</details>\n'
				},
				draw: svelteBlock(DetailsBlock)
			})
		]
	})
});
