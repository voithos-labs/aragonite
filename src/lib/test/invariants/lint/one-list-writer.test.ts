/**
 * G4.259: on the fix-up's path every write to a list of blocks goes through
 * `node-primitives.ts :: spliceList`, which calls the list's `beforeWrite` first. A keystroke saves
 * its leaf's list there for its rollback, so a write that skipped it would survive a rolled-back key.
 */

import { collectEditorSources } from './scan-source';
import { describeFileRules } from './file-rule';
import { SOURCE } from './source-paths';

/** The files a fix-up runs through, the leaf's own write and the copies before a write included;
 *  the fix-up's package writes its own working copy, never a list it was handed. */
const FIX_UP_PATH = [
	SOURCE.fixUpApply,
	SOURCE.contentWrite,
	SOURCE.separatorWrites,
	SOURCE.unshare,
	SOURCE.chainRebuild,
	'src/lib/tree-operations/children.ts',
	SOURCE.nodePrimitives
];

/** A snippet scanned as the fix-up's own file, which the rule binds. */
const inFixUp = (code: string) => ({ relPath: SOURCE.fixUpApply, code });

/** A splice, a push, an index store, or a `spliceMany` into a `children` array. */
const LIST_WRITE =
	/\b(?:children|siblings|parentChildren)!?\s*\.\s*(?:splice|push|pop|shift|unshift)\s*\(|\b(?:children|siblings|parentChildren)!?\s*\[[^\]]+\]\s*=(?!=)|\bspliceMany\s*\(\s*[\w.!]*(?:children|siblings)\b/;

describeFileRules(
	[
		{
			id: 'G4.259 a list of blocks on the fix-up’s path is written only through spliceList',
			population: (file) => FIX_UP_PATH.includes(file.relPath),
			matches: LIST_WRITE,
			reason:
				'the fix-up wrote a list of blocks directly, which a keystroke’s rollback never hears: call `spliceList`',
			reaches: FIX_UP_PATH,
			hits: [
				inFixUp('body.children.push(block);'),
				inFixUp('spliceMany(body.children, at, 1, blocks);'),
				inFixUp('parent.children[index] = replacement;'),
				inFixUp('parentChildren[index] = copyNode(node, sharing);')
			],
			misses: [
				inFixUp('spliceList(body, at, 1, blocks);'),
				inFixUp('const node = parent.children[index];'),
				inFixUp('if (children[i] === node) return;'),
				inFixUp('spliceMany(container.childIds, at, removeCount, ids);')
			]
		}
	],
	collectEditorSources()
);
