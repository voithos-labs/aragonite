/**
 * The admonitions registered through the process-wide registrars, for the suites that read with the
 * page's grammar (`parse(source)`, `installPlugins`) and take a `:::note` box as their colon container
 * (kind `admonition`) or a `> [!NOTE]` alert as their headed quote (kind `githubAlert`). These are
 * the admonitions package as it was before it became a plugin value (`./admonitions/`); the
 * package's own rows are under `test/plugins/admonitions/`.
 */
export { admonitionsPlugin as registeredAdmonitions } from './admonitions/admonitions-plugin';
export { registerAdmonitions } from './admonitions/admonition-kind';
export { registerGithubAlert } from './admonitions/github-alert-kind';
export {
	ADMONITION,
	GITHUB_ALERT,
	type AdmonitionMetadata,
	type GithubAlertMetadata
} from './admonitions/kinds';
export { default as AdmonitionBlock } from './admonitions/AdmonitionBlock.svelte';
