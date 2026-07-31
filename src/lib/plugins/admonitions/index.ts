// Two kinds sharing one component: the `:::name` directives, which all resolve to
// one admonition kind, and native GitHub alerts (`> [!NOTE]`, kind `githubAlert`).
export { admonitionsPlugin } from './register';
export type { AdmonitionsOptions } from './admonition-kind';

// convertGithubAlerts is naive full-text and rewrites inside code fences; for a whole
// document prefer convertGithubAlertsInDocument, which scopes through the parser.
export { convertGithubAlerts, hasGithubAlert } from './gh-alert';
export type { AlertConversion } from './gh-alert';
export { convertGithubAlertsInDocument } from './convert-document';
export {
	ADMONITION_KINDS,
	GITHUB_ALERT,
	type AdmonitionName,
	type GithubAlertMetadata
} from './kinds';
