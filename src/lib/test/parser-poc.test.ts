/**
 * Smoke tests for the Phase 0 markdown parser proof of concept.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
    parseBlocksProofOfConcept,
    parseMarkdownProofOfConcept,
    serializeProofOfConceptDocument,
} from "../core/parser/index.js";
import { MIXED_GFM_FIXTURE } from "./fixtures/mixed-gfm-fixture.js";

test("Phase 0 parser PoC classifies the mixed fixture into expected block kinds", () => {
    const document = parseMarkdownProofOfConcept(MIXED_GFM_FIXTURE);

    assert.deepEqual(
        document.blocks.map((block) => block.kind),
        ["heading", "paragraph", "listItem", "listItem", "blockquote", "fencedCode", "thematicBreak"]
    );

    const paragraphTokens = document.blocks[1].inlineTokens.map((token) => token.kind);
    assert.deepEqual(paragraphTokens, ["strong", "strikethrough", "inlineCode", "autolink"]);

    const secondListItemTokens = document.blocks[3].inlineTokens.map((token) => token.kind);
    assert.deepEqual(secondListItemTokens, ["image"]);

    const blockquoteTokens = document.blocks[4].inlineTokens.map((token) => token.kind);
    assert.deepEqual(blockquoteTokens, ["link"]);
});

test("Phase 0 parser PoC preserves exact source through parse and serialize", () => {
    const document = parseMarkdownProofOfConcept(MIXED_GFM_FIXTURE);

    assert.equal(serializeProofOfConceptDocument(document), MIXED_GFM_FIXTURE);
});

test("Phase 0 block pass preserves leading and trailing blank-line ownership", () => {
    const fixture = "\n\n# Title\n\nParagraph\n\n";
    const document = parseBlocksProofOfConcept(fixture);

    assert.equal(document.prefix, "\n\n");
    assert.equal(document.blocks.length, 2);
    assert.equal(document.blocks[1].leadingTrivia, "\n");
    assert.equal(document.suffix, "\n");
});
