// The conformance suite a plugin listing runs over this package, published as `./conformance`.
import type {
	ContainerConformanceProfile,
	PluginConformanceSuite
} from '@voithos-labs/aragonite/testing';
import { getPluginMetadata, setPluginMetadata } from '@voithos-labs/aragonite/plugin';
import { mermaidPlugin, MERMAID } from './index';
import type { MermaidMetadata } from './mermaid-kind';

const CHILDLESS =
	'the diagram is metadata behind a fence, so this container has no child scopes at all: no ' +
	'local index to address, no ancestry to rebuild through, and no child to bubble focus from';

export const mermaidProfile: ContainerConformanceProfile = {
	deepNesting: { source: '```mermaid\ngraph TD\n```\n', leafPath: [0] },
	terminatorCollisionFixture: {
		source: '```mermaid\ngraph TD\n```\n',
		bodyRaw: 'graph TD\n```\nafter\n',
		// The body lives in typed metadata, so the write reaches it the way the edit box's commit does.
		writeBody: (node, body) => {
			const meta = getPluginMetadata<MermaidMetadata>(node);
			setPluginMetadata<MermaidMetadata>(node, { ...meta!, code: body });
		}
	},
	localIndex: { mode: 'exempt', reason: CHILDLESS },
	ancestry: { mode: 'exempt', reason: CHILDLESS },
	multiScope: { mode: 'exempt', reason: CHILDLESS },
	focusBubble: { mode: 'exempt', reason: CHILDLESS },
	terminatorCollision: { mode: 'assert' }
};

const suite: PluginConformanceSuite = {
	plugins: [mermaidPlugin()],
	containers: { [MERMAID]: mermaidProfile }
};

export default suite;
