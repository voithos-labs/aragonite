/**
 * Slash rows whose `run` waits on the page before it writes, the shape of a host's picker (open a
 * dialog, await the choice, insert). The spec releases the wait through `window.__releaseHeldRun`.
 */
import type { SlashCommandEntry } from '$lib/plugins/slash-commands';

declare global {
	interface Window {
		__releaseHeldRun?: () => void;
	}
}

const held = () => new Promise<void>((release) => (window.__releaseHeldRun = release));

export const HELD_SLASH_ENTRIES: SlashCommandEntry[] = [
	{
		id: 'held-embed',
		label: 'Held embed',
		run: async (editor) => {
			await held();
			await editor.insertMarkdown('> embed', { placement: 'below' });
		}
	},
	{
		id: 'held-heading',
		label: 'Held heading',
		run: async (editor) => {
			await held();
			editor.runCommand('heading.cycle', 2);
		}
	}
];
