#!/usr/bin/env node

const { hashPassword } = require("../src/auth");

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

async function main() {
  if (!process.stdin.isTTY) {
    throw new Error("Run this command in an interactive terminal so the password is not exposed.");
  }

  const password = await readSecret("New administrator password: ");
  const confirmation = await readSecret("Confirm administrator password: ");
  if (password !== confirmation) throw new Error("Passwords do not match.");
  const encoded = await hashPassword(password);
  process.stdout.write(`\nADMIN_PASSWORD_HASH='${encoded}'\n`);
}

function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stderr;
    let value = "";
    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");

    const finish = (error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      output.write("\n");
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (data) => {
      for (const character of data) {
        if (character === "\u0003") return finish(new Error("Password setup cancelled."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " " && character !== "\u007f") value += character;
      }
    };

    input.on("data", onData);
  });
}
