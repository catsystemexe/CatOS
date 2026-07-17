#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
if (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.CODEX_ACCESS_TOKEN) { process.stderr.write("credential leaked\n"); process.exit(88); }
if (process.env.FAKE_CODEX_CAPTURE) fs.writeFileSync(process.env.FAKE_CODEX_CAPTURE, JSON.stringify({ args, stdin: fs.readFileSync(0, "utf8"), env: process.env }));
const final = value("--output-last-message");
if (process.env.FAKE_CODEX_MODE === "timeout") setInterval(() => {}, 1000);
if (process.env.FAKE_CODEX_MODE === "signal") process.kill(process.pid, "SIGTERM");
if (process.env.FAKE_CODEX_MODE === "invalid") fs.writeFileSync(final, "{bad");
else fs.writeFileSync(final, JSON.stringify({ status: "COMPLETED", summary: "done", changes: [], checksRunByAgent: [], remainingConcerns: [] }));
process.stdout.write(JSON.stringify({ type: "event" }) + "\n");
if (process.env.FAKE_CODEX_MODE === "large") process.stderr.write("x".repeat(10000));
