import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { ZodError } from "zod";
import { projectConfigSchema, type ProjectConfig } from "./projectConfigSchema.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type LoadedProjectConfig = {
  config: ProjectConfig;
  configPath: string;
  absoluteConfigPath: string;
  absoluteRepoPath: string;
};

export async function loadProjectConfig(configPath: string, cwd = process.cwd()): Promise<LoadedProjectConfig> {
  const absoluteConfigPath = path.resolve(cwd, configPath);
  let raw: string;

  try {
    raw = await readFile(absoluteConfigPath, "utf8");
  } catch (error) {
    throw new ConfigError(`Konfigurační soubor nebyl nalezen nebo nejde přečíst: ${configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (error) {
    throw new ConfigError(`Konfigurační soubor ${configPath} není validní YAML.`);
  }

  let config: ProjectConfig;
  try {
    config = projectConfigSchema.parse(parsed);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
      throw new ConfigError(`Konfigurace ${configPath} není validní: ${details}`);
    }
    throw error;
  }

  const absoluteRepoPath = path.resolve(path.dirname(absoluteConfigPath), config.project.repoPath);
  try {
    await access(absoluteRepoPath);
  } catch (error) {
    throw new ConfigError(`Cílový repozitář neexistuje nebo není dostupný: ${config.project.repoPath} (${absoluteRepoPath})`);
  }

  return { config, configPath, absoluteConfigPath, absoluteRepoPath };
}
