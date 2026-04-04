import { execSync, spawnSync } from 'node:child_process';

export interface FileChange {
  status: string;
  file: string;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: string[];
}

export function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function getRepoName(): string {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
    return match?.[1] ?? process.cwd().split('/').pop()!;
  } catch {
    return process.cwd().split('/').pop()!;
  }
}

export function getBranch(): string {
  return execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
}

export function getAheadBehind(): { ahead: number; behind: number } {
  try {
    const result = execSync('git rev-list --left-right --count HEAD...@{upstream}', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const [ahead, behind] = result.split('\t').map(Number);
    return { ahead, behind };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

export function getStatus(): GitStatus {
  const branch = getBranch();
  const { ahead, behind } = getAheadBehind();

  const output = execSync('git status --porcelain=v1', { encoding: 'utf-8' });
  // Split first, then trim each line's trailing whitespace only — leading spaces are significant
  const lines = output.split('\n').filter((l) => l.length > 0);

  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    // Porcelain v1 format: XY PATH (or XY ORIG -> PATH for renames)
    // X = index/staged status, Y = worktree status
    const match = line.match(/^(.)(.) (.+)$/);
    if (!match) continue;

    const [, x, y, rawFile] = match;

    // Git wraps paths with spaces/special chars in double quotes — strip them
    const file = rawFile.startsWith('"') && rawFile.endsWith('"')
      ? rawFile.slice(1, -1)
      : rawFile;

    if (x === '?' && y === '?') {
      untracked.push(file);
    } else {
      if (x !== ' ' && x !== '?') {
        staged.push({ status: x, file });
      }
      if (y !== ' ' && y !== '?') {
        unstaged.push({ status: y, file });
      }
    }
  }

  return { branch, ahead, behind, staged, unstaged, untracked };
}

export function getRecentCommits(count = 5): string[] {
  try {
    return execSync(`git log --oneline --format="%C(yellow)%h%C(reset)  %s  %C(dim)%cr%C(reset)" -${count}`, {
      encoding: 'utf-8',
    }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export function getRecentCommitsPlain(count = 5): Array<{ hash: string; message: string; time: string }> {
  try {
    const lines = execSync(`git log --oneline --format="%h\t%s\t%cr" -${count}`, {
      encoding: 'utf-8',
    }).trim().split('\n').filter(Boolean);
    return lines.map((line) => {
      const [hash, message, time] = line.split('\t');
      return { hash, message, time };
    });
  } catch {
    return [];
  }
}

export function getStagedDiff(): string {
  return execSync('git diff --cached', { encoding: 'utf-8' });
}

export function getDiffStat(base?: string): string {
  try {
    if (base) {
      return execSync(`git diff ${base}...HEAD --stat`, { encoding: 'utf-8' }).trim();
    }
    // Default: show staged diff stat
    return execSync('git diff --cached --stat', { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

export function getCommitsSince(base: string): string[] {
  try {
    return execSync(`git log ${base}..HEAD --oneline`, { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function stageFiles(files: string[]): void {
  const result = spawnSync('git', ['add', '--', ...files], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`git add failed: ${result.stderr || result.stdout}`);
  }
}

export function unstageFiles(files: string[]): void {
  const result = spawnSync('git', ['reset', 'HEAD', '--', ...files], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`git reset failed: ${result.stderr || result.stdout}`);
  }
}

export function commitChanges(message: string): string {
  const result = spawnSync('git', ['commit', '-m', message], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || 'Commit failed').trim();
    throw new Error(err);
  }
  return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
}

export function pushToRemote(): void {
  // Pull with rebase first to avoid divergence (e.g. CI pushed release commits)
  const pull = spawnSync('git', ['pull', '--rebase'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (pull.status !== 0) {
    // Abort the rebase if it failed (conflicts)
    spawnSync('git', ['rebase', '--abort'], { stdio: 'pipe' });
    throw new Error(`Pull --rebase failed (possible conflicts):\n${pull.stderr || pull.stdout}`);
  }

  const result = spawnSync('git', ['push'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    // try setting upstream
    const branch = getBranch();
    const retry = spawnSync('git', ['push', '-u', 'origin', branch], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (retry.status !== 0) {
      throw new Error(retry.stderr || 'Push failed');
    }
  }
}

export function getDefaultBranch(): string {
  try {
    const result = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result.replace('refs/remotes/origin/', '');
  } catch {
    // fallback: check if main or master exists
    try {
      execSync('git rev-parse --verify main', { stdio: 'pipe' });
      return 'main';
    } catch {
      return 'master';
    }
  }
}

export function hasChanges(): boolean {
  const output = execSync('git status --porcelain=v1', { encoding: 'utf-8' }).trim();
  return output.length > 0;
}
