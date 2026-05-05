import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  isGitRepo,
  getStatus,
  getStagedDiff,
  stageFiles,
  unstageFiles,
  commitChanges,
  pushToRemote,
  getBranch,
  getDefaultBranch,
  getCommitsSince,
  getDiffStat,
} from './lib/git.js';
import { generateCommitMessage, generatePRDescription, isCodexAvailable } from './lib/ai.js';
import { createPR, mergePR, isGhAvailable } from './lib/pr.js';

function bail(msg: string): never {
  p.cancel(msg);
  process.exit(0);
}

function checkCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) bail('Cancelled.');
  return value as T;
}

function requireTool(name: string, available: boolean, installCmd: string): void {
  if (!available) {
    p.log.error(
      `${pc.bold(name)} is not installed.\n` +
      `  Install it with: ${pc.cyan(installCmd)}`
    );
    process.exit(1);
  }
}

async function main() {
  console.log('');
  p.intro(pc.bgCyan(pc.black(' gcm ')));

  if (!isGitRepo()) {
    p.log.error('Not a git repository.');
    p.outro('');
    process.exit(1);
  }

  requireTool('codex', isCodexAvailable(), 'npm install -g @openai/codex');
  requireTool('gh', isGhAvailable(), 'brew install gh && gh auth login');

  const status = getStatus();

  // ── Stage files ──────────────────────────────────────────
  // Single unified multiselect: already-staged files are pre-checked,
  // unstaged/untracked files are unchecked. User controls everything.

  const allFiles = [
    ...status.staged.map((f) => ({ status: f.status, file: f.file, staged: true })),
    ...status.unstaged.map((f) => ({ status: f.status, file: f.file, staged: false })),
    ...status.untracked.map((f) => ({ status: '?', file: f, staged: false })),
  ];

  if (allFiles.length === 0) {
    p.log.warn('No changes to commit.');
    p.outro('Nothing to do.');
    process.exit(0);
  }

  // Use numeric indices as values to avoid any path mangling by clack
  const selectedIndices = checkCancel(
    await p.multiselect({
      message: 'Select files to commit',
      options: allFiles.map((f, i) => {
        const color = f.staged ? pc.green
          : f.status === '?' ? pc.dim
          : f.status === 'D' ? pc.red
          : pc.yellow;
        const tag = f.staged ? pc.green('staged') : pc.dim(f.status === '?' ? 'untracked' : 'modified');
        return {
          value: i,
          label: `${color(f.file)}  ${tag}`,
        };
      }),
      initialValues: allFiles.map((_, i) => i),
      required: true,
    }),
  );

  // Map indices back to file paths
  const selectedSet = new Set(selectedIndices as number[]);

  // Only stage files that aren't already staged — re-running `git add` on a
  // staged deletion fails ("pathspec did not match") because the path is gone
  // from the worktree, and re-adding a staged rename's destination is wasted work.
  const toStage = (selectedIndices as number[])
    .map((i) => allFiles[i])
    .filter((f) => !f.staged)
    .map((f) => f.file);
  if (toStage.length > 0) stageFiles(toStage);

  // Unstage any files that were previously staged but deselected
  const toUnstage = allFiles
    .filter((f, i) => f.staged && !selectedSet.has(i))
    .map((f) => f.file);
  if (toUnstage.length > 0) unstageFiles(toUnstage);

  // Verify something is actually staged
  const stagedCheck = getStatus();
  if (stagedCheck.staged.length === 0) {
    p.log.error('No changes staged. The selected files may not have any modifications.');
    p.outro('');
    process.exit(1);
  }

  p.log.success(`${stagedCheck.staged.length} file(s) staged for commit`);

  // ── Commit message ───────────────────────────────────────

  const diff = getStagedDiff();
  const stagedStat = getDiffStat();

  const s = p.spinner();
  s.start('Generating commit message...');
  const generated = await generateCommitMessage(diff, stagedStat);

  if (!generated) {
    s.stop('Generation failed');
    p.log.error('Codex failed to generate a commit message. Check that codex is authenticated and working.');
    process.exit(1);
  }

  s.stop('Message generated');
  p.note(generated, 'Commit message');

  const action = checkCancel(
    await p.select({
      message: 'Use this message?',
      options: [
        { value: 'use', label: 'Use as-is' },
        { value: 'edit', label: 'Edit it' },
        { value: 'rewrite', label: 'Write my own' },
      ],
    }),
  );

  let msg: string;
  if (action === 'use') {
    msg = generated;
  } else if (action === 'edit') {
    msg = checkCancel(
      await p.text({
        message: 'Edit commit message',
        initialValue: generated,
        validate: (v) => (v.length === 0 ? 'Message cannot be empty' : undefined),
      }),
    );
  } else {
    msg = checkCancel(
      await p.text({
        message: 'Enter commit message',
        placeholder: 'feat(scope): description',
        validate: (v) => (v.length === 0 ? 'Message cannot be empty' : undefined),
      }),
    );
  }

  // ── Commit ───────────────────────────────────────────────

  try {
    const hash = commitChanges(msg);
    p.log.success(`Committed ${pc.dim(hash)}`);
  } catch (err) {
    p.log.error(`Commit failed: ${err instanceof Error ? err.message : err}`);
    p.outro('');
    process.exit(1);
  }

  // ── Push ─────────────────────────────────────────────────

  const shouldPush = checkCancel(
    await p.confirm({ message: 'Push to remote?' }),
  );

  if (shouldPush) {
    const ps = p.spinner();
    ps.start('Pushing...');
    try {
      pushToRemote();
      ps.stop('Pushed!');
    } catch (err) {
      ps.stop('Push failed');
      p.log.error(err instanceof Error ? err.message : String(err));
      p.outro('Committed locally.');
      process.exit(1);
    }
  }

  // ── PR flow ──────────────────────────────────────────────

  const branch = getBranch();
  const defaultBranch = getDefaultBranch();

  if (shouldPush && branch !== defaultBranch) {
    const wantPR = checkCancel(
      await p.confirm({
        message: `Create PR? ${pc.dim(`${branch} → ${defaultBranch}`)}`,
        initialValue: true,
      }),
    );

    if (wantPR) {
      // PR title
      const prTitle = checkCancel(
        await p.text({
          message: 'PR title',
          initialValue: msg,
          validate: (v) => (v.length === 0 ? 'Title cannot be empty' : undefined),
        }),
      );

      // Generate PR description
      const prSpinnerDesc = p.spinner();
      prSpinnerDesc.start('Generating PR description...');

      const commits = getCommitsSince(defaultBranch);
      const diffStat = getDiffStat(defaultBranch);

      const prDesc = await generatePRDescription({
        branch,
        baseBranch: defaultBranch,
        commits,
        diffStat,
      });

      if (!prDesc) {
        prSpinnerDesc.stop('Generation failed');
        p.log.error('Codex failed to generate PR description. Check that codex is authenticated and working.');
        process.exit(1);
      }

      prSpinnerDesc.stop('Description generated');
      p.note(prDesc, 'PR Description');

      const descAction = checkCancel(
        await p.select({
          message: 'Use this description?',
          options: [
            { value: 'use', label: 'Use as-is' },
            { value: 'edit', label: 'Edit it' },
          ],
        }),
      );

      let prBody: string;
      if (descAction === 'use') {
        prBody = prDesc;
      } else {
        prBody = checkCancel(
          await p.text({
            message: 'Edit PR description',
            initialValue: prDesc,
          }),
        );
      }

      // Create PR
      const prSpinner = p.spinner();
      prSpinner.start('Creating PR...');
      try {
        const prUrl = createPR({ title: prTitle, body: prBody, base: defaultBranch, head: branch });
        prSpinner.stop('PR created!');
        p.log.success(pc.cyan(prUrl));

        // Merge option
        const mergeAction = checkCancel(
          await p.select({
            message: 'Merge PR?',
            options: [
              { value: 'squash', label: 'Squash and merge' },
              { value: 'merge', label: 'Merge commit' },
              { value: 'rebase', label: 'Rebase and merge' },
              { value: 'skip', label: 'Leave open' },
            ],
          }),
        );

        if (mergeAction !== 'skip') {
          const ms = p.spinner();
          ms.start('Merging...');
          try {
            mergePR(mergeAction as 'squash' | 'merge' | 'rebase');
            ms.stop('Merged & branch deleted!');
          } catch (err) {
            ms.stop('Merge failed');
            p.log.error(err instanceof Error ? err.message : String(err));
          }
        }
      } catch (err) {
        prSpinner.stop('PR creation failed');
        p.log.error(err instanceof Error ? err.message : String(err));
      }
    }
  }

  p.outro(pc.green('Done!'));
}

main().catch((err) => {
  p.log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
