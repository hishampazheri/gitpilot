import { spawnSync, execSync } from 'node:child_process';

export function isGhAvailable(): boolean {
  try {
    execSync('which gh', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function createPR(params: { title: string; body: string; base: string; head: string }): string {
  const result = spawnSync('gh', [
    'pr', 'create',
    '--title', params.title,
    '--base', params.base,
    '--head', params.head,
    '--body', params.body,
  ], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || 'Failed to create PR');
  }

  return result.stdout.trim();
}

export function mergePR(method: 'squash' | 'merge' | 'rebase' = 'squash'): void {
  const result = spawnSync('gh', ['pr', 'merge', `--${method}`, '--delete-branch'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || 'Failed to merge PR');
  }
}
