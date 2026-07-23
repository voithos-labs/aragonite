// Admonitions plugin — public entry. `admonitionsPlugin()` teaches the editor two
// kinds sharing one component: the five `:::name` directives (`:::note` …
// `:::caution`), which all resolve to one admonition kind, and native GitHub alerts
// (`> [!NOTE]` blockquotes, kind `githubAlert`). Pass `{ convertAlertsOnPaste: true }`
// to rewrite pasted alerts to directive source instead of rendering them natively.
export { admonitionsPlugin } from './register';
export type { AdmonitionsOptions } from './admonition-kind';

// convertGithubAlerts is naive full-text: it rewrites alert-shaped lines even
// inside code fences. For a whole document, prefer convertGithubAlertsInDocument,
// which scopes through the parser and leaves fenced code untouched.
export { convertGithubAlerts, hasGithubAlert } from './gh-alert';
export type { AlertConversion } from './gh-alert';
export { convertGithubAlertsInDocument } from './convert-document';
export {
	ADMONITION_KINDS,
	GITHUB_ALERT,
	type AdmonitionName,
	type GithubAlertMetadata
} from './kinds';
