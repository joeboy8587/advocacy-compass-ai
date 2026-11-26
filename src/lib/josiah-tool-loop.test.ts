import { test } from "node:test";
import { strict as assert } from "node:assert";
import { contentToolCalls, requireJosiahAnswer, runJosiahToolLoop, type JosiahModelMessage } from "./josiah-tool-loop.server";

test("the reported list_tables JSON action is executed and followed by an answer", async () => {
  const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
  let requests = 0;
  const result = await runJosiahToolLoop({
    messages: [{ role: "user", content: "Check the available tables" }],
    execute: async (name, args) => { executed.push({ name, args }); return [{ table_name: "detections" }]; },
    call: async (messages) => {
      requests++;
      if (requests === 1) return { role: "assistant", content: '{"action":"list_tables"}' };
      assert.equal(messages.at(-1)?.role, "tool");
      assert.equal(messages.at(-1)?.content, '[{"table_name":"detections"}]');
      return { role: "assistant", content: "The detections table is available." };
    },
  });
  assert.deepEqual(executed, [{ name: "list_tables", args: {} }]);
  assert.equal(result.text, "The detections table is available.");
  assert.equal(result.toolCalls, 1);
});

test("native provider calls continue through the same read-only executor", async () => {
  const replies: JosiahModelMessage[] = [
    { role: "assistant", content: null, tool_calls: [{ id: "lookup1", type: "function", function: { name: "search_detections", arguments: '{"identifier":"N913KC"}' } }] },
    { role: "assistant", content: "Found a timestamped sighting." },
  ];
  const result = await runJosiahToolLoop({ messages: [], call: async () => {
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected request");
    return reply;
  }, execute: async (name, args) => {
    assert.equal(name, "search_detections");
    assert.equal(args["identifier"], "N913KC");
    return { rows: [{ captured_at: "2026-11-26T06:20:00Z" }] };
  } });
  assert.equal(result.text, "Found a timestamped sighting.");
  assert.equal(result.toolCalls, 1);
});

test("fenced commands preserve parameters but quoted commands in prose never execute", () => {
  assert.equal(contentToolCalls('```json\n{"action":"list_tables","parameters":{"filter":"detections"}}\n```')[0]?.function.arguments, '{"filter":"detections"}');
  assert.deepEqual(contentToolCalls('The previous reply was {"action":"list_tables"}.'), []);
  assert.deepEqual(contentToolCalls('{"lines":[{"speaker":"A","text":"Hello"}]}'), []);
});

test("unknown commands and malformed arguments cannot run", () => {
  assert.throws(() => contentToolCalls('{"action":"delete_records"}'), /unsupported command/);
  assert.throws(() => contentToolCalls('{"action":"list_tables","arguments":"bad"}'), /invalid command arguments/);
});

test("an exhausted tool budget never returns a command as an answer", async () => {
  let requests = 0;
  await assert.rejects(runJosiahToolLoop({ messages: [], maxSteps: 1,
    execute: async () => [],
    call: async (_messages, tools) => {
      requests++;
      assert.equal(tools, requests === 1);
      return { role: "assistant", content: '{"action":"list_tables"}' };
    },
  }), /could not finish/);
  assert.equal(requests, 2);
});

test("all fallback providers reject empty or command-only answers but preserve real structured output", () => {
  assert.throws(() => requireJosiahAnswer('{"action":"list_tables"}'), /did not finish/);
  assert.throws(() => requireJosiahAnswer("  "), /did not finish/);
  assert.equal(requireJosiahAnswer('{"verdict":"UNRESOLVED"}'), '{"verdict":"UNRESOLVED"}');
});