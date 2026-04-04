import pc from 'picocolors';
import { isGitRepo, getRepoName, getStatus, getDiffStat } from './lib/git.js';

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    M: 'modified',
    A: 'added',
    D: 'deleted',
    R: 'renamed',
    C: 'copied',
    U: 'unmerged',
  };
  return labels[status] ?? status;
}

function addSection(
  lines: string[],
  title: string,
  titleColor: (s: string) => string,
  items: Array<{ icon: string; text: string }>,
  itemColor: (s: string) => string,
  maxItems: number,
): void {
  if (items.length === 0) return;

  lines.push(`  ${titleColor(pc.bold(title))} ${pc.dim(`(${items.length})`)}`);

  const visible = items.slice(0, maxItems);
  const remaining = items.length - visible.length;

  for (const item of visible) {
    lines.push(`  ${itemColor(item.icon)}  ${itemColor(item.text)}`);
  }

  if (remaining > 0) {
    lines.push(`  ${pc.dim(`   ... +${remaining} more`)}`);
  }

  lines.push('');
}

function buildOutput(maxLines?: number): string[] {
  if (!isGitRepo()) {
    return [pc.red('  Not a git repository')];
  }

  const repo = getRepoName();
  const status = getStatus();

  const lines: string[] = [''];

  // Header: repo name and branch
  const branchInfo = [pc.bold(pc.cyan(status.branch))];
  if (status.ahead > 0) branchInfo.push(pc.green(`↑${status.ahead}`));
  if (status.behind > 0) branchInfo.push(pc.red(`↓${status.behind}`));

  lines.push(`  ${pc.dim(repo)}  ${branchInfo.join('  ')}`);
  lines.push('');

  const hasStaged = status.staged.length > 0;
  const hasUnstaged = status.unstaged.length > 0;
  const hasUntracked = status.untracked.length > 0;
  const hasAny = hasStaged || hasUnstaged || hasUntracked;

  if (!hasAny) {
    lines.push(`  ${pc.dim('Clean working tree')}`);
  } else {
    // Calculate how many items we can show per section.
    // Reserve lines for: header(1) + blank(1) + footer(2) + section headers/blanks.
    // If no maxLines, show everything.
    const sectionCount = [hasStaged, hasUnstaged, hasUntracked].filter(Boolean).length;
    // Each section uses: 1 header + 1 blank = 2 overhead lines
    const overhead = 4 + sectionCount * 2 + (hasAny ? 2 : 0); // header + diffstat + footer
    const totalItems = status.staged.length + status.unstaged.length + status.untracked.length;
    const availableForItems = maxLines ? Math.max(sectionCount * 3, maxLines - overhead) : totalItems;

    // Distribute available lines proportionally across sections
    const allocate = (count: number) => {
      if (!maxLines) return count;
      return Math.max(2, Math.round((count / totalItems) * availableForItems));
    };

    if (hasStaged) {
      addSection(
        lines,
        'Staged',
        pc.green,
        status.staged.map((f) => ({
          icon: f.status === 'A' ? '+' : f.status === 'D' ? '-' : '~',
          text: `${f.file}  ${pc.dim(statusLabel(f.status))}`,
        })),
        pc.green,
        allocate(status.staged.length),
      );
    }

    if (hasUnstaged) {
      addSection(
        lines,
        'Changes',
        pc.yellow,
        status.unstaged.map((f) => ({
          icon: f.status === 'D' ? '-' : '~',
          text: `${f.file}  ${pc.dim(statusLabel(f.status))}`,
        })),
        pc.yellow,
        allocate(status.unstaged.length),
      );
    }

    if (hasUntracked) {
      addSection(
        lines,
        'Untracked',
        pc.dim,
        status.untracked.map((f) => ({ icon: '?', text: f })),
        pc.dim,
        allocate(status.untracked.length),
      );
    }

    // Diff stat summary
    const stat = getDiffStat();
    if (stat) {
      const lastLine = stat.split('\n').pop()?.trim();
      if (lastLine && lastLine.includes('changed')) {
        lines.push(`  ${pc.dim(lastLine)}`);
        lines.push('');
      }
    }
  }

  return lines;
}

// CLI
const args = process.argv.slice(2);
const watchMode = args.includes('-w') || args.includes('--watch');
const interval = (() => {
  const idx = args.indexOf('--interval');
  if (idx !== -1 && args[idx + 1]) return parseInt(args[idx + 1], 10) * 1000;
  return 2000;
})();

if (watchMode) {
  // Enter alternate screen buffer (like vim/htop)
  process.stdout.write('\x1B[?1049h');
  process.stdout.write('\x1B[?25l');

  const cleanup = () => {
    process.stdout.write('\x1B[?25h');
    process.stdout.write('\x1B[?1049l');
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('exit', cleanup);

  const tick = () => {
    try {
      const rows = process.stdout.rows || 24;
      const lines = buildOutput(rows - 2); // reserve for footer + padding
      lines.push('');
      lines.push(pc.dim(`  Ctrl+C to exit`));

      process.stdout.write('\x1B[H\x1B[2J');
      process.stdout.write(lines.join('\n') + '\n');
    } catch {
      // silently retry next tick
    }
  };

  tick();
  setInterval(tick, interval);

  // Re-render on terminal resize
  process.stdout.on('resize', tick);
} else {
  if (!isGitRepo()) {
    console.log(pc.red('  Not a git repository'));
    process.exit(1);
  }
  console.log(buildOutput().join('\n'));
}
