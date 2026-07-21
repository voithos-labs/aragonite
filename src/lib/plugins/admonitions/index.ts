// Admonitions plugin — public entry. `admonitionsPlugin()` teaches the editor the
// five `:::name` directives (`:::note` … `:::caution`), which all resolve to one
// admonition kind, and binds the component; the GitHub-alert paste helpers are
// re-exported for the host to wire into its own paste flow.
export { admonitionsPlugin } from './register';

// convertGithubAlerts is naive full-text: it rewrites alert-shaped lines even
// inside code fences. For a whole document, prefer convertGithubAlertsInDocument,
// which scopes through the parser and leaves fenced code untouched.
export { convertGithubAlerts, hasGithubAlert } from './gh-alert';
export type { AlertConversion } from './gh-alert';
export { convertGithubAlertsInDocument } from './convert-document';
export { ADMONITION_KINDS, type AdmonitionName } from './kinds';
