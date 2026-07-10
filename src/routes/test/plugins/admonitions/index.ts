/**
 * Admonitions plugin — public entry. One `installAdmonitions()` call teaches the
 * editor the five admonition kinds (`:::note` … `:::caution`), binds the
 * component, and returns the GitHub-alert paste transform for the host to wire in.
 * Register before the editor mounts so the seed parses to the admonition kind.
 */
import {
	registerBlockComponent,
	defineBlockComponent,
	isBlockComponentRegistered
} from '$lib/plugin';
import { registerAdmonitions } from './register';
import { admonitionKind } from './kinds';
import AdmonitionBlock from './AdmonitionBlock.svelte';

export function installAdmonitions(): void {
	registerAdmonitions();
	if (!isBlockComponentRegistered(admonitionKind())) {
		registerBlockComponent(admonitionKind(), defineBlockComponent(AdmonitionBlock));
	}
}

export { convertGithubAlerts, hasGithubAlert } from './gh-alert';
export type { AlertConversion } from './gh-alert';
export { convertGithubAlertsInDocument } from './convert-document';
export { ADMONITION_KINDS, type AdmonitionName } from './kinds';
