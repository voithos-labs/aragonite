/**
 * Admonitions plugin — public entry. `admonitionsPlugin()` teaches the editor the
 * five admonition kinds (`:::note` … `:::caution`) and binds the component; the
 * GitHub-alert paste helpers are re-exported for the host to wire into its own
 * paste flow. The plugin unit installs the setup once per process.
 */
import {
	definePlugin,
	registerBlockComponent,
	defineBlockComponent,
	type EditorPlugin
} from '$lib/plugin';
import { registerAdmonitions } from './register';
import { admonitionKind } from './kinds';
import AdmonitionBlock from './AdmonitionBlock.svelte';

export function admonitionsPlugin(): EditorPlugin {
	return definePlugin({
		name: 'admonitions',
		setup() {
			registerAdmonitions();
			registerBlockComponent(admonitionKind(), defineBlockComponent(AdmonitionBlock));
		}
	});
}

// convertGithubAlerts is naive full-text: it rewrites alert-shaped lines even
// inside code fences. For a whole document, prefer convertGithubAlertsInDocument,
// which scopes through the parser and leaves fenced code untouched.
export { convertGithubAlerts, hasGithubAlert } from './gh-alert';
export type { AlertConversion } from './gh-alert';
export { convertGithubAlertsInDocument } from './convert-document';
export { ADMONITION_KINDS, type AdmonitionName } from './kinds';
