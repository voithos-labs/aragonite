/**
 * The admonitions registered through the process-wide registrars, for the suites that read with the
 * page's grammar (`parse(source)`, `installPlugins`) and take a `:::note` box as their colon container
 * (kind `admonition`) or a `> [!NOTE]` alert as their headed quote (kind `githubAlert`).
 */
export { admonitionsPlugin as registeredAdmonitions } from '#packages/admonitions/src/index.js';
export { registerAdmonitions } from '#packages/admonitions/src/admonition-kind.js';
export { registerGithubAlert } from '#packages/admonitions/src/github-alert-kind.js';
export {
	ADMONITION,
	GITHUB_ALERT,
	type AdmonitionMetadata,
	type GithubAlertMetadata
} from '#packages/admonitions/src/kinds.js';
export { default as AdmonitionBlock } from '#packages/admonitions/src/AdmonitionBlock.svelte';
