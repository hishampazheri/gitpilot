import { spawn, execSync } from 'node:child_process';

const MAX_DIFF_LENGTH = 15000;

const NOISE_PATTERNS = [
  /^diff --git a\/.*\.lock\b/,
  /^diff --git a\/.*-lock\./,
  /^diff --git a\/.*\.lockb\b/,
  /^diff --git a\/.*\.generated\./,
  /^diff --git a\/.*\.min\.(js|css)\b/,
  /^diff --git a\/.*\.map\b/,
];

export function isCodexAvailable(): boolean {
  try {
    execSync('which codex', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function runCodex(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('codex', ['exec', '--model', 'gpt-5.4-mini', '--json', prompt], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    proc.on('close', () => {
      const lines = output.split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(lines[i]);
          if (parsed.type === 'item.completed') {
            resolve(parsed.item?.text?.trim() || null);
            return;
          }
        } catch {
          // skip non-JSON lines
        }
      }
      resolve(null);
    });

    proc.on('error', () => resolve(null));
  });
}

/**
 * Split a unified diff into per-file chunks, filter out noise (lock files,
 * generated files, source maps), and rejoin. Returns { filtered, isOnlyNoise }.
 */
function filterDiff(diff: string): { filtered: string; isOnlyNoise: boolean } {
  const chunks = diff.split(/(?=^diff --git )/m);
  const kept: string[] = [];
  let droppedCount = 0;

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const isNoise = NOISE_PATTERNS.some((p) => p.test(chunk));
    if (isNoise) {
      droppedCount++;
    } else {
      kept.push(chunk);
    }
  }

  if (kept.length === 0 && droppedCount > 0) {
    return { filtered: '', isOnlyNoise: true };
  }

  return { filtered: kept.join(''), isOnlyNoise: false };
}

export async function generateCommitMessage(diff: string, diffStat: string): Promise<string | null> {
  const { filtered, isOnlyNoise } = filterDiff(diff);

  let prompt: string;

  if (isOnlyNoise) {
    // Only lock/generated files changed — diff stat is enough context
    prompt = `Generate a conventional commit message for a dependency/generated file update.

Changed files:
${diffStat}

Rules:
- Use format: type(scope): description
- Types: feat, fix, docs, style, refactor, test, chore
- Keep first line under 72 characters
- Be specific and concise
- Output ONLY the commit message, nothing else
- Output plain text only, no markdown, no code blocks, no backticks`;
  } else {
    const codeDiff = filtered.length > MAX_DIFF_LENGTH
      ? filtered.slice(0, MAX_DIFF_LENGTH) + '\n... (truncated)'
      : filtered;

    prompt = `Generate a conventional commit message for the following changes.

File summary (all changed files):
${diffStat}

Code diff (lock files and generated files excluded):
${codeDiff}

Rules:
- Use format: type(scope): description
- Types: feat, fix, docs, style, refactor, test, chore
- Keep first line under 72 characters
- Be specific and concise
- Output ONLY the commit message, nothing else
- Output plain text only, no markdown, no code blocks, no backticks`;
  }

  return runCodex(prompt);
}

export async function generatePRDescription(params: {
  branch: string;
  baseBranch: string;
  commits: string[];
  diffStat: string;
}): Promise<string | null> {
  const prompt = `Generate a pull request description for merging "${params.branch}" into "${params.baseBranch}".

Commits included:
${params.commits.join('\n')}

Diff summary:
${params.diffStat}

Use this exact format:

## Summary
<1-3 concise bullet points summarizing the changes>

## Changes
<detailed list of what changed and why>

## Test Plan
<how to verify these changes work>

Rules:
- Be specific and concise
- Output ONLY the PR description in the format above, nothing else`;

  return runCodex(prompt);
}
