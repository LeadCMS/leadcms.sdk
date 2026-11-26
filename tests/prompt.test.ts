/**
 * ask(): a prompt that rejects when its input ends instead of leaving the
 * process to exit 0 mid-question (issue #5).
 */

import readline from "readline";
import { PassThrough } from "stream";
import { ask, PromptInputClosedError } from "../src/lib/prompt";

function makeInterface() {
  const input = new PassThrough();
  const output = new PassThrough();
  const rl = readline.createInterface({ input, output });
  return { input, rl };
}

describe("ask", () => {
  it("resolves with a piped answer", async () => {
    const { input, rl } = makeInterface();
    const answer = ask(rl, "Proceed? (y/N): ");
    input.write("y\n");
    await expect(answer).resolves.toBe("y");
    rl.close();
  });

  it("rejects when the input ends before an answer arrives", async () => {
    const { input, rl } = makeInterface();
    const answer = ask(rl, "Proceed? (y/N): ", "Pass --yes (-y) to push without prompts.");
    input.end();
    await expect(answer).rejects.toBeInstanceOf(PromptInputClosedError);
  });

  it("rejects when the interface closed after an earlier answer", async () => {
    const { input, rl } = makeInterface();
    const first = ask(rl, "Create types? (y/n) [y]: ");
    input.end("y\n");
    await expect(first).resolves.toBe("y");
    await new Promise((resolve) => setImmediate(resolve));

    await expect(ask(rl, "Proceed? (y/N): ")).rejects.toBeInstanceOf(PromptInputClosedError);
  });

  it("names the question without colour codes, and the hint", async () => {
    const { input, rl } = makeInterface();
    const answer = ask(
      rl,
      "\nProceed with \x1b[1m\x1b[36m3\x1b[0m changes? (y/N): ",
      "Pass --yes (-y) to push without prompts."
    );
    input.end();
    await expect(answer).rejects.toThrow(
      'Cannot ask "Proceed with 3 changes? (y/N):": standard input closed before an answer arrived (no terminal attached?). Pass --yes (-y) to push without prompts.'
    );
  });
});
