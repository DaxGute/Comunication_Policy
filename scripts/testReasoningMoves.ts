/**
 * Speaker-authored SET / REVISE / REMOVE parsing.
 *
 * Run: npm run test:reasoning-moves
 */
import assert from "node:assert/strict";
import { parseAgentTurn, parseReasoningMutation } from "../src/reasoning";

{
  const parsed = parseAgentTurn(
    JSON.stringify({
      message: "Across 5 looks like EMAIL.",
      mutations: [
        { type: "SET", subjectId: "crossword:across:5", content: "EMAIL" },
      ],
    }),
    "agent_a",
    1,
  );
  assert.equal(parsed.message, "Across 5 looks like EMAIL.");
  assert.deepEqual(parsed.mutations, [
    { type: "SET", subjectId: "crossword:across:5", content: "EMAIL" },
  ]);
  assert.equal(parsed.protocolFailure, undefined);
}

{
  const parsed = parseAgentTurn(
    [
      "MESSAGE:",
      "I don't think NOLAN works for Down 6 anymore.",
      "MUTATIONS:",
      JSON.stringify([
        {
          type: "REVISE",
          subjectId: "crossword:down:6",
          before: "NOLAN",
          after: "ATARI",
        },
      ]),
    ].join("\n"),
    "agent_b",
    2,
  );
  assert.match(parsed.message, /ATARI|NOLAN/);
  assert.equal(parsed.mutations[0]?.type, "REVISE");
}

{
  const parsed = parseAgentTurn(
    JSON.stringify({ message: "What crossing supports that?", mutations: [] }),
    "agent_a",
    3,
  );
  assert.deepEqual(parsed.mutations, []);
  assert.equal(parsed.protocolFailure, undefined);
}

{
  const parsed = parseReasoningMutation({
    type: "REVISE",
    subjectId: "moral:obligation",
    fromVersionId: "pv-4",
    after: "Weaker under pressure.",
  });
  assert.deepEqual(parsed, {
    type: "REVISE",
    subjectId: "moral:obligation",
    fromVersionId: "pv-4",
    after: "Weaker under pressure.",
  });
}

{
  const parsed = parseReasoningMutation({
    action: "REMOVE",
    subjectId: "moral:responsibility",
    before: "Blame is binary.",
  });
  assert.deepEqual(parsed, {
    type: "REMOVE",
    subjectId: "moral:responsibility",
    before: "Blame is binary.",
  });
}

{
  const parsed = parseAgentTurn("EMAIL seems right for 5-across.", "agent_a", 1);
  assert.equal(parsed.mutations.length, 0);
  assert.ok(parsed.protocolFailure);
}

{
  const parsed = parseAgentTurn(
    JSON.stringify({
      message: "Bad array entry.",
      mutations: [
        { type: "SET", subjectId: "proof:goal", content: "G" },
        { type: "REVISE" },
      ],
    }),
    "agent_a",
    1,
  );
  assert.equal(parsed.mutations.length, 2);
  assert.equal(parsed.mutations[0]?.type, "SET");
  assert.equal(parsed.mutations[1]?.type, "invalid");
}

console.log("ok — reasoning mutation envelopes");
