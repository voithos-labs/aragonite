/**
 * The characters the inline scanner handles itself, one row each: the handler it runs and when
 * the fast bail (`needsScan`, ./index.ts) looks for the character. The fast bail and the plugin
 * registry's reserved triggers (./plugin-syntax.ts) derive from this table, and a test holds the
 * scanner's switch to its rows.
 */

import { handleAngle } from './autolinks';
import { handleBang, handleCloseBracket, handleOpenBracket } from './brackets';
import { handleBacktick } from './code-spans';
import { handleDelimiter } from './emphasis';
import type { ScanContext } from './scan-state';
import { handleAmpersand, handleBackslash, handleNewline } from './simple-nodes';

/**
 * When the fast bail looks for a trigger: `always`; `when-registered`, only while a plugin
 * handler is registered on it; or `never`, which also refuses a plugin handler on it.
 */
export type TriggerScan = 'always' | 'when-registered' | 'never';

export interface BuiltinTrigger {
	handler: (ctx: ScanContext) => void;
	scanned: TriggerScan;
}

export const BUILTIN_TRIGGERS: ReadonlyMap<string, BuiltinTrigger> = new Map([
	['\\', { handler: handleBackslash, scanned: 'always' }],
	['`', { handler: handleBacktick, scanned: 'always' }],
	['&', { handler: handleAmpersand, scanned: 'always' }],
	['\n', { handler: handleNewline, scanned: 'always' }],
	['*', { handler: handleDelimiter, scanned: 'always' }],
	['_', { handler: handleDelimiter, scanned: 'always' }],
	['~', { handler: handleDelimiter, scanned: 'always' }],
	['[', { handler: handleOpenBracket, scanned: 'always' }],
	// `!` and `]` matter to the built-in scan only in a range holding a `[`, so prose such as
	// "Hello!" skips the scan loop.
	['!', { handler: handleBang, scanned: 'when-registered' }],
	[']', { handler: handleCloseBracket, scanned: 'never' }],
	['<', { handler: handleAngle, scanned: 'always' }]
] satisfies [string, BuiltinTrigger][]);
