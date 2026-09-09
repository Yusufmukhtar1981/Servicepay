#!/usr/bin/env node
const { spawn } = require("node:child_process");
const path = require("node:path");

const children = [
  spawn(process.execPath, [path.join(__dirname, "index.js")], { stdio: "inherit", env: process.env }),
  spawn(process.execPath, [path.join(__dirname, "worker.js")], { stdio: "inherit", env: process.env }),
];

let stopping = false;
const stop = signal => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
};

process.once("SIGTERM", () => stop("SIGTERM"));
process.once("SIGINT", () => stop("SIGINT"));

for (const child of children) {
  child.once("error", error => {
    console.error(`VULL sandbox process failed to start: ${error.message}`);
    process.exitCode = 1;
    stop("SIGTERM");
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(`VULL sandbox child exited unexpectedly (code=${code}, signal=${signal || "none"}).`);
      process.exitCode = code || 1;
      stop("SIGTERM");
    }
  });
}

Promise.all(children.map(child => new Promise(resolve => child.once("close", resolve))))
  .then(() => process.exit(process.exitCode || 0));