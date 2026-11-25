// The `setup` registration's kind names and metadata; the names and the cycle order are the package's.
export {
	ADMONITION_KINDS,
	capitalize,
	coerceAdmonitionName,
	type AdmonitionName
} from '#packages/admonitions/src/kinds.js';

export const ADMONITION = 'admonition';
export const GITHUB_ALERT = 'githubAlert';

/** The name, read at parse; the opener line itself is child 0. */
export interface AdmonitionMetadata {
	name: string;
}

/** The marker's type as typed (`NOTE`, `Note`), stored verbatim so the writer re-emits it. */
export interface GithubAlertMetadata {
	alertType: string;
}
