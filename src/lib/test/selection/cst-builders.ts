// Hand-shaped CST nodes for the path-walk suites, which assert tree navigation, not parsing.

import type { CstNode, Document } from '../../core/nodes';

export function para(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

export function bq(children: CstNode[]): CstNode {
	return {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '',
		metadata: { quoteDepth: 1 },
		children,
		innerPrefix: '',
		innerSuffix: ''
	};
}

export function doc(children: CstNode[]): Document {
	return { kind: 'document', prefix: '', children, suffix: '' };
}
