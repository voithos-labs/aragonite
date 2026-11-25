// Callouts: `:::note` boxes and native GitHub alerts (`> [!NOTE]`), drawn by one component.
export { admonitions } from './admonitions-plugin';
export type { AdmonitionsOptions } from './admonitions-plugin';

// convertGithubAlerts scans plain text and rewrites inside code fences too; for a whole
// document prefer convertGithubAlertsInDocument, which goes through the parser.
export { convertGithubAlerts, hasGithubAlert } from './gh-alert';
export type { AlertConversion } from './gh-alert';
export { convertGithubAlertsInDocument } from './convert-document';
export {
	ADMONITION_KINDS,
	type AdmonitionData,
	type AdmonitionName,
	type AlertData
} from './kinds';
