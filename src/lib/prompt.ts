/**
 * Prompting that fails loudly when nobody can answer.
 *
 * A bare `rl.question()` never settles once its input has ended (stdin is
 * `/dev/null`, a closed pipe, or a pipe that ran out of answers): the event
 * loop empties and Node exits 0 having done nothing, which in CI reads as a
 * successful push. `ask()` rejects instead, so the command exits non-zero
 * with a message that says how to run it without prompts.
 */

import type { Interface } from "readline";
import { stripVTControlCharacters } from "util";

export class PromptInputClosedError extends Error {
  constructor(prompt: string, hint?: string) {
    const question = stripVTControlCharacters(prompt).trim();
    super(
      `Cannot ask "${question}": standard input closed before an answer arrived (no terminal attached?).` +
        (hint ? ` ${hint}` : "")
    );
    this.name = "PromptInputClosedError";
  }
}

/**
 * Ask `prompt` on `rl` and resolve with the answer. Rejects with
 * PromptInputClosedError when the input ends first, or has already ended.
 * Piped answers still work: only a missing answer is an error.
 *
 * @param hint Appended to the error, e.g. "Pass --yes to run without prompts."
 */
export function ask(rl: Interface, prompt: string, hint?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onClose = () => {
      if (settled) return;
      settled = true;
      reject(new PromptInputClosedError(prompt, hint));
    };

    rl.once("close", onClose);
    try {
      rl.question(prompt, (answer) => {
        if (settled) return;
        settled = true;
        rl.removeListener("close", onClose);
        resolve(answer);
      });
    } catch (error) {
      rl.removeListener("close", onClose);
      if (settled) return;
      settled = true;
      // Node throws ERR_USE_AFTER_CLOSE when the interface closed earlier,
      // e.g. a shared interface whose input ended after a previous answer.
      const code = (error as NodeJS.ErrnoException).code;
      reject(code === "ERR_USE_AFTER_CLOSE" ? new PromptInputClosedError(prompt, hint) : error);
    }
  });
}
