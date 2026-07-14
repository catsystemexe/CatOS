export type RepositoryLike = { id?: string; source?: string; name?: string; path?: string; localPath?: string; fullName?: string };
export function canonicalPath(value: unknown): string;
export function canonicalEqual(a: unknown, b: unknown): boolean;
export function findRepository<T extends RepositoryLike>(repositories: T[], wanted?: RepositoryLike): T | undefined;
export function createBranchLoader<T extends RepositoryLike, B extends { name: string }>(options: {
  getSelectedRepository: () => T | undefined;
  fetchBranches: (key: string, repo?: T) => Promise<{ branches: B[] }>;
  applyBranches: (branches: B[], repo: T) => void;
  clearBranches: () => void;
  setError: (message: string) => void;
}): { invalidate(): void; load(repo?: T): Promise<void> };
