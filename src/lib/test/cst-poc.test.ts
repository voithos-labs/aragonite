/**
 * Smoke tests for the Phase 0 CST proof of concept and ownership invariants.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
    buildCstOwnershipProofOfConcept,
    buildDelimiterAccountingProof,
    buildRecoveryRegionProofs,
    validateCstOwnershipProof,
} from "../core/cst/index.js";
import {
    BLOCKQUOTE_OWNERSHIP_FIXTURE,
    DELIMITER_ACCOUNTING_FIXTURE,
    LIST_TRIVIA_FIXTURE,
    PARAGRAPH_TRIVIA_FIXTURE,
    PARTIAL_LINK_FIXTURE,
    RAW_HTML_FIXTURE,
    UNCLOSED_FENCE_FIXTURE,
} from "./fixtures/cst-poc-fixtures.js";

test("CST PoC assigns paragraph separator trivia to the following paragraph", () => {
    const proof = buildCstOwnershipProofOfConcept(PARAGRAPH_TRIVIA_FIXTURE);
    const validation = validateCstOwnershipProof(proof);

    assert.equal(validation.ok, true);
    assert.equal(proof.nodes.length, 2);
    assert.equal(proof.nodes[1].leadingTriviaRange?.start, 15);
    assert.equal(proof.nodes[1].leadingTriviaRange?.end, 16);
    assert.equal(PARAGRAPH_TRIVIA_FIXTURE.slice(15, 16), "\n");
});

test("CST PoC assigns blockquote markers to syntax tokens instead of trivia", () => {
    const proof = buildCstOwnershipProofOfConcept(BLOCKQUOTE_OWNERSHIP_FIXTURE);
    const validation = validateCstOwnershipProof(proof);
    const tokenSources = proof.nodes[0].tokens.map((token) => token.source);

    assert.equal(validation.ok, true);
    assert.deepEqual(tokenSources, ["> ", "> "]);
    assert.equal(proof.segments.some((segment) => segment.kind === "leadingTrivia" && segment.source.includes(">")), false);
});

test("CST PoC assigns blank list separator trivia to the following list item", () => {
    const proof = buildCstOwnershipProofOfConcept(LIST_TRIVIA_FIXTURE);
    const validation = validateCstOwnershipProof(proof);

    assert.equal(validation.ok, true);
    assert.equal(proof.nodes.length, 2);
    assert.equal(proof.nodes[1].leadingTriviaRange !== undefined, true);
    assert.equal(LIST_TRIVIA_FIXTURE.slice(proof.nodes[1].leadingTriviaRange!.start, proof.nodes[1].leadingTriviaRange!.end), "  \n");
});

test("CST PoC delimiter accounting keeps consumed and literal delimiter bytes separate", () => {
    const proof = buildDelimiterAccountingProof(DELIMITER_ACCOUNTING_FIXTURE);

    assert.equal(proof.entries.length, 1);
    assert.equal(proof.entries[0].kind, "strong");
    assert.equal(proof.entries[0].delimiter, "**");
    assert.deepEqual(proof.literalDelimiterRanges.map((range) => DELIMITER_ACCOUNTING_FIXTURE.slice(range.start, range.end)), ["*"]);
});

test("CST PoC recovery proofs preserve incomplete and opaque regions exactly", () => {
    const proofs = [
        ...buildRecoveryRegionProofs(PARTIAL_LINK_FIXTURE),
        ...buildRecoveryRegionProofs(UNCLOSED_FENCE_FIXTURE),
        ...buildRecoveryRegionProofs(RAW_HTML_FIXTURE),
    ];

    assert.deepEqual(
        proofs.map((proof) => [proof.kind, proof.reason, proof.source]),
        [
            ["recovery", "partialLink", "[partial link\n"],
            ["recovery", "unclosedFence", "```ts\nconst value = 1;\n"],
            ["opaque", "rawHtml", "<details>hidden</details>\n"],
        ]
    );
});
