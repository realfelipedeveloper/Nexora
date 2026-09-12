import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { readHiddenInputFrom } from "./hidden-input.js";

type TtyInput = NodeJS.ReadStream & PassThrough;
type TtyOutput = NodeJS.WriteStream & PassThrough;

function ttyStreams() {
  const input = new PassThrough() as TtyInput;
  const output = new PassThrough() as TtyOutput;
  const chunks: string[] = [];

  Object.defineProperties(input, {
    isRaw: { configurable: true, value: false, writable: true },
    isTTY: { configurable: true, value: true },
  });
  Object.defineProperty(output, "isTTY", { configurable: true, value: true });
  input.setRawMode = vi.fn((mode: boolean) => {
    input.isRaw = mode;
    return input;
  });
  output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));

  return { chunks, input, output };
}

describe("hidden terminal input", () => {
  it("requires both input and output to be interactive terminals", async () => {
    const first = ttyStreams();
    Object.defineProperty(first.input, "isTTY", { configurable: true, value: false });
    await expect(readHiddenInputFrom("Password: ", first.input, first.output)).rejects.toThrow(
      /interactive terminal/u,
    );

    const second = ttyStreams();
    Object.defineProperty(second.output, "isTTY", { configurable: true, value: false });
    await expect(readHiddenInputFrom("Password: ", second.input, second.output)).rejects.toThrow(
      /interactive terminal/u,
    );
  });

  it.each(["return", "enter"])("reads without echoing through %s", async (submitKey) => {
    const { chunks, input, output } = ttyStreams();
    const result = readHiddenInputFrom("Password: ", input, output);

    input.emit("keypress", "secret", { name: "s" });
    input.emit("keypress", "x", { ctrl: true, name: "x" });
    input.emit("keypress", "x", { meta: true, name: "x" });
    input.emit("keypress", "", { name: "backspace" });
    input.emit("keypress", "t", { name: "t" });
    input.emit("keypress", "", { name: submitKey });

    await expect(result).resolves.toBe("secret");
    expect(chunks.join("")).toBe("Password: \n");
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it.each(["c", "d"])("supports secure cancellation with Ctrl+%s", async (keyName) => {
    const { input, output } = ttyStreams();
    const result = readHiddenInputFrom("Password: ", input, output);

    input.emit("keypress", "", { ctrl: true, name: keyName });

    await expect(result).rejects.toThrow(/cancelled/u);
  });

  it("fails closed when the terminal input ends", async () => {
    const { input, output } = ttyStreams();
    const result = readHiddenInputFrom("Password: ", input, output);

    input.emit("end");

    await expect(result).rejects.toThrow(/ended unexpectedly/u);
  });
});
