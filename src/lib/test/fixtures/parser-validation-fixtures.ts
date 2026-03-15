/****
 * Fixture-driven parser validation cases for the Phase 0 proof of concept.
 ****/
import type {
    ProofOfConceptBlockKind,
    ProofOfConceptBlockMetadata,
    ProofOfConceptInlineTokenKind,
} from "../../core/parser/poc-types.js";

export interface ParserValidationCase {
    name: string;
    source: string;
    expectedBlockKinds: ProofOfConceptBlockKind[];
    expectedInlineTokens?: Array<{
        blockIndex: number;
        kinds: ProofOfConceptInlineTokenKind[];
    }>;
    expectedBlockMetadata?: Array<{
        blockIndex: number;
        metadata: Partial<ProofOfConceptBlockMetadata>;
    }>;
    expectedFenceClosed?: boolean;
    expectedRecoveryReasons?: string[];
}

export interface ParserValidationCaseGroup {
    label: string;
    cases: ParserValidationCase[];
}

export const COMMONMARK_SUPPORTED_PARSER_CASES: ParserValidationCase[] = [
    {
        name: "ATX heading with indentation",
        source: "  ## Title\n",
        expectedBlockKinds: ["heading"],
        expectedBlockMetadata: [{ blockIndex: 0, metadata: { headingLevel: 2 } }],
    },
    {
        name: "paragraph with emphasis, code span, and inline link",
        source: "Paragraph with *em*, **strong**, `code`, and [link](https://example.com).\n",
        expectedBlockKinds: ["paragraph"],
        expectedInlineTokens: [{ blockIndex: 0, kinds: ["emphasis", "strong", "inlineCode", "link"] }],
    },
    {
        name: "blockquote continuation lines",
        source: "> Quote\n> Still quote\n",
        expectedBlockKinds: ["blockquote"],
        expectedBlockMetadata: [{ blockIndex: 0, metadata: { quoteDepth: 1 } }],
    },
    {
        name: "unordered list items",
        source: "- one\n- two\n",
        expectedBlockKinds: ["listItem", "listItem"],
        expectedBlockMetadata: [
            { blockIndex: 0, metadata: { listMarker: "-", ordered: false } },
            { blockIndex: 1, metadata: { listMarker: "-", ordered: false } },
        ],
    },
    {
        name: "ordered list items with parenthesis delimiter",
        source: "1) one\n2) two\n",
        expectedBlockKinds: ["listItem", "listItem"],
        expectedBlockMetadata: [
            { blockIndex: 0, metadata: { listMarker: "1)", ordered: true } },
            { blockIndex: 1, metadata: { listMarker: "2)", ordered: true } },
        ],
    },
    {
        name: "fenced code block with tilde fence",
        source: "~~~ts\nconsole.log(1);\n~~~~\n",
        expectedBlockKinds: ["fencedCode"],
        expectedBlockMetadata: [{ blockIndex: 0, metadata: { fenceMarker: "~", fenceLength: 3, closed: true } }],
        expectedFenceClosed: true,
    },
    {
        name: "thematic break with spaced markers",
        source: "* * *\n",
        expectedBlockKinds: ["thematicBreak"],
        expectedBlockMetadata: [{ blockIndex: 0, metadata: { thematicMarker: "*" } }],
    },
];

export const GFM_SUPPORTED_PARSER_CASES: ParserValidationCase[] = [
    {
        name: "paragraph with strikethrough",
        source: "Before ~~gone~~ after\n",
        expectedBlockKinds: ["paragraph"],
        expectedInlineTokens: [{ blockIndex: 0, kinds: ["strikethrough"] }],
    },
    {
        name: "checked task list item",
        source: "- [x] done\n",
        expectedBlockKinds: ["listItem"],
        expectedBlockMetadata: [
            { blockIndex: 0, metadata: { listMarker: "-", ordered: false, taskItem: true, taskChecked: true } },
        ],
    },
    {
        name: "unchecked task list item with star marker",
        source: "* [ ] todo\n",
        expectedBlockKinds: ["listItem"],
        expectedBlockMetadata: [
            { blockIndex: 0, metadata: { listMarker: "*", ordered: false, taskItem: true, taskChecked: false } },
        ],
    },
    {
        name: "bare URL and email autolinks",
        source: "Visit https://example.com or email team@example.com\n",
        expectedBlockKinds: ["paragraph"],
        expectedInlineTokens: [{ blockIndex: 0, kinds: ["autolink", "autolink"] }],
    },
    {
        name: "image syntax remains an atomic inline token",
        source: "Image ![alt](image.png) inline\n",
        expectedBlockKinds: ["paragraph"],
        expectedInlineTokens: [{ blockIndex: 0, kinds: ["image"] }],
    },
];

export const PRESERVE_ONLY_AND_FALLBACK_CASES: ParserValidationCase[] = [
    {
        name: "setext heading preserve-only fallback",
        source: "Heading\n=====\n",
        expectedBlockKinds: ["paragraph"],
    },
    {
        name: "indented code block preserve-only fallback",
        source: "    const value = 1;\n",
        expectedBlockKinds: ["paragraph"],
    },
    {
        name: "table preserve-only fallback",
        source: "| A | B |\n| --- | --- |\n| 1 | 2 |\n",
        expectedBlockKinds: ["paragraph"],
    },
    {
        name: "reference definition preserve-only fallback",
        source: "[ref]: https://example.com \"Title\"\n",
        expectedBlockKinds: ["paragraph"],
    },
    {
        name: "unclosed fenced code recovery fallback",
        source: "```ts\nconst value = 1;\n",
        expectedBlockKinds: ["fencedCode"],
        expectedBlockMetadata: [{ blockIndex: 0, metadata: { fenceMarker: "`", fenceLength: 3, closed: false } }],
        expectedFenceClosed: false,
        expectedRecoveryReasons: ["unclosedFence"],
    },
    {
        name: "partial link recovery fallback",
        source: "A [partial link\n",
        expectedBlockKinds: ["paragraph"],
        expectedRecoveryReasons: ["partialLink"],
    },
    {
        name: "raw HTML opaque fallback proof",
        source: "<details>hidden</details>\n",
        expectedBlockKinds: ["paragraph"],
        expectedRecoveryReasons: ["rawHtml"],
    },
];

export const PARSER_VALIDATION_CASE_GROUPS: ParserValidationCaseGroup[] = [
    {
        label: "CommonMark-aligned supported",
        cases: COMMONMARK_SUPPORTED_PARSER_CASES,
    },
    {
        label: "GFM-aligned supported",
        cases: GFM_SUPPORTED_PARSER_CASES,
    },
    {
        label: "Preserve-only and fallback",
        cases: PRESERVE_ONLY_AND_FALLBACK_CASES,
    },
];
