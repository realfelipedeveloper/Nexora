import { emitKeypressEvents } from "node:readline";

type Keypress = {
  ctrl?: boolean;
  meta?: boolean;
  name?: string;
};

export class SecureInputError extends Error {
  override readonly name = "SecureInputError";
}

export async function readHiddenInput(prompt: string) {
  return readHiddenInputFrom(prompt, process.stdin, process.stderr);
}

export async function readHiddenInputFrom(
  prompt: string,
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
) {
  if (!input.isTTY || !output.isTTY) {
    throw new SecureInputError("Secure password input requires an interactive terminal.");
  }

  output.write(prompt);
  emitKeypressEvents(input);

  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();

  return new Promise<string>((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      input.removeListener("keypress", onKeypress);
      input.removeListener("end", onEnd);
      input.setRawMode(wasRaw);
      input.pause();
    };

    const onEnd = () => {
      cleanup();
      reject(new SecureInputError("Password input ended unexpectedly."));
    };

    const onKeypress = (input: string, key: Keypress) => {
      if (key.ctrl && (key.name === "c" || key.name === "d")) {
        cleanup();
        output.write("\n");
        reject(new SecureInputError("Password input cancelled."));
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup();
        output.write("\n");
        resolve(value);
        return;
      }

      if (key.name === "backspace" || key.name === "delete") {
        value = Array.from(value).slice(0, -1).join("");
        return;
      }

      if (!key.ctrl && !key.meta && input) {
        value += input;
      }
    };

    input.on("keypress", onKeypress);
    input.on("end", onEnd);
  });
}
