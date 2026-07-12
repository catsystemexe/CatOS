import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadProjectConfig } from "../src/config/loadConfig.js";

async function writeConfig(root: string, content: string): Promise<void> {
  await mkdir(path.join(root, "projects"), { recursive: true });
  await writeFile(path.join(root, "projects", "demo.yaml"), content, "utf8");
}

const validConfig = (repoPath: string) => `
project:
  id: demo
  name: Demo project
  repoPath: ${repoPath}
  baseBranch: main
commands:
  typecheck: npm run typecheck
  test: npm run test
  build: npm run build
workflow:
  maxReworkAttempts: 2
  createCommit: false
permissions:
  allowNetwork: false
  allowPush: false
  allowMerge: false
`;

describe("loadProjectConfig", () => {
  it("loads a valid config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "catos-config-"));
    await mkdir(path.join(root, "repo"));
    await writeConfig(root, validConfig("../repo"));

    const loaded = await loadProjectConfig("projects/demo.yaml", root);

    expect(loaded.config.project.id).toBe("demo");
    expect(loaded.config.project.name).toBe("Demo project");
    expect(loaded.absoluteRepoPath).toBe(path.join(root, "repo"));
    expect(loaded.config.codex.sandboxMode).toBe("workspace-write");
    expect(loaded.config.codex.acknowledgeNoSandbox).toBe(false);
    expect(loaded.config.validation.timeoutMs).toBe(120_000);
  });

  it("rejects danger-full-access without explicit acknowledgement", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "catos-danger-config-"));
    await mkdir(path.join(root, "repo"));
    await writeConfig(root, `${validConfig("../repo")}codex:
  sandboxMode: danger-full-access
`);

    await expect(loadProjectConfig("projects/demo.yaml", root)).rejects.toThrow("acknowledgeNoSandbox");
  });

  it("accepts danger-full-access with explicit acknowledgement", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "catos-danger-ack-config-"));
    await mkdir(path.join(root, "repo"));
    await writeConfig(root, `${validConfig("../repo")}codex:
  sandboxMode: danger-full-access
  acknowledgeNoSandbox: true
`);

    const loaded = await loadProjectConfig("projects/demo.yaml", root);

    expect(loaded.config.codex.sandboxMode).toBe("danger-full-access");
    expect(loaded.config.codex.acknowledgeNoSandbox).toBe(true);
  });

  it("rejects an invalid config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "catos-invalid-config-"));
    await writeConfig(root, "project:\n  id: demo\n");

    await expect(loadProjectConfig("projects/demo.yaml", root)).rejects.toThrow(ConfigError);
  });

  it("fails when repo path does not exist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "catos-missing-repo-"));
    await writeConfig(root, validConfig("../missing-repo"));

    await expect(loadProjectConfig("projects/demo.yaml", root)).rejects.toThrow("Cílový repozitář neexistuje");
  });
});
