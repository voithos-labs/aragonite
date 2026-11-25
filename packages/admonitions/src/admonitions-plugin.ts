/**
 * Callouts: a `:::note` box, one type over five names whose opening line is its title row, and
 * GitHub's `> [!NOTE]` alert, kept as GitHub bytes. One component draws both. With
 * `convertAlertsOnPaste`, an alert a paste brings lands as the `:::` box instead.
 */

import {
	builtin,
	colonLines,
	command,
	container,
	definePlugin,
	pasteRewrite,
	QUOTE_LINES,
	type Block
} from '@voithos-labs/aragonite/plugin';
import { svelteBlock } from '@voithos-labs/aragonite/svelte';
import AdmonitionBlock from './AdmonitionBlock.svelte';
import { convertGithubAlertsInDocument } from './convert-document';
import { hasGithubAlert } from './gh-alert';
import {
	ADMONITION_KINDS,
	coerceAdmonitionName,
	type AdmonitionData,
	type AlertData
} from './kinds';

export interface AdmonitionsOptions {
	/** Rewrite a pasted GitHub alert to `:::name` source (default false); off, it stays an alert. */
	convertAlertsOnPaste?: boolean;
}

// The box's next name, the last wrapping round to the first, as one undo step.
const nextKind = command<Block<AdmonitionData>>({
	id: 'next-kind',
	title: 'Next kind',
	run(editor, block) {
		const at = ADMONITION_KINDS.indexOf(coerceAdmonitionName(block.data.name));
		const name = ADMONITION_KINDS[(at + 1) % ADMONITION_KINDS.length];
		void editor
			.edit()
			.data(block, { ...block.data, name })
			.commit();
	}
});

const admonition = container<AdmonitionData>({
	name: 'admonition',
	label: 'Admonition',
	role: 'prose',
	lines: colonLines({ names: ADMONITION_KINDS }),
	chords: { 'Mod+7': nextKind },
	sample: ':::note Heads up\n\nbody\n\n:::\n',
	insert: {
		label: 'Note',
		icon: 'info',
		keywords: ['note', 'admonition', 'callout'],
		insert: ':::note\n\n:::\n'
	},
	draw: svelteBlock(AdmonitionBlock)
});

const HEAD = new RegExp(`^[ \\t]*\\[!(${ADMONITION_KINDS.join('|')})\\][ \\t]*$`, 'i');

const alert = container<AlertData>({
	name: 'alert',
	label: 'Alert',
	// Ahead of the quote, which would take the alert as a plain one.
	before: builtin.blocks.blockquote,
	interrupts: true,
	merges: { key: 'alertType' },
	lines: {
		...QUOTE_LINES,
		head: {
			match: HEAD,
			data: (match) => ({ alertType: match[1] }),
			write: (data) => `[!${data.alertType}]`
		}
	},
	sample: '> [!NOTE]\n> Heads up.\n',
	insert: { none: 'the note row inserts the box spelling of the same callout' },
	draw: svelteBlock(AdmonitionBlock)
});

// The whole paste, read as text, so one alert line pasted into a paragraph converts too.
const alertsToBoxes = pasteRewrite({
	name: 'github-alerts',
	sample: '> [!NOTE]\n> Heads up.\n',
	into({ text }) {
		if (!hasGithubAlert(text)) return null;
		const { converted, changed } = convertGithubAlertsInDocument(text);
		return changed ? converted : null;
	}
});

/** Callouts and GitHub alerts: list `admonitions`, or `admonitions({ convertAlertsOnPaste })`. */
export const admonitions = definePlugin<AdmonitionsOptions>({
	name: 'admonitions',
	version: '0.11.5',
	editor: '0.11.5',
	defaults: { convertAlertsOnPaste: false },
	contributes: ({ convertAlertsOnPaste }) => ({
		blocks: [admonition, alert],
		pasteRewrites: convertAlertsOnPaste ? [alertsToBoxes] : []
	})
});
