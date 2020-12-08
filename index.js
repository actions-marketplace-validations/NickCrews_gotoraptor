const path = require('path');
const proc = require('child_process');

const core = require('@actions/core');
const github = require('@actions/github');

const clang_tools_bin_dir = require('clang-tools-prebuilt');

async function getChangedCFiles(ok, owner, repo, pr) {
  core.debug(`fetching changed files from ${owner}/${repo} PR #${pr}`);
  const response = await ok.pulls.listFiles({
    owner: owner,
    repo: repo,
    pull_number: pr,
    page: 0,
    per_page: 300
  });
  const all_filenames = response.data.map(file => file.filename);
  core.debug(`detected changes in the files ${all_filenames}`)
  /* regex for c, cc, h, hpp */
  const pattern = /.*\.[ch](p{2})?$/;
  const c_filenames = all_filenames.filter(name => name.match(pattern));
  core.debug(`detected changes in the C/C++ files ${c_filenames}`)

  if (c_filenames.length == 0) {
      core.info("No C/C++ files changed...");
      core.setOutput('gotos', 'False');
      process.exit(0);
  }
  return c_filenames;
}

async function runClangTidy(files) {
    const clang_tidy_path = path.join(clang_tools_bin_dir, 'clang-tidy');
    const { GITHUB_WORKSPACE } = process.env;
    const args = process.argv.slice(2)
        .concat('-checks=-*,cppcoreguidelines-avoid-goto')
        .concat(files);
    const child = proc.spawnSync(clang_tidy_path, args, {
        stdio: 'inherit',
        cwd: GITHUB_WORKSPACE,
        timeout: 30 * 1000
    });
    core.debug(`Ran clang-tidy: ${JSON.stringify(child)}`);
    if (child.status) {
      throw new Error(`clang-tidy failed: ${JSON.stringify(child)}`);
    }
    return child.stdout;
}

async function sendVelociraptors(ok, owner, repo, pr) {
  core.debug(`Sending velociraptors to pull request #${pr}`);
  // await ok.pulls.createReviewComment({
  await ok.issues.createComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    // pull_number: pr.number,
    issue_number: pr,
    body: 'YOU ADDED A GOTO'
  });
  core.debug(`Sent velociraptors to pull request #${pr}`);
}

async function run() {
  try {
    if (github.context.eventName != 'pull_request') {
      throw new Error('`gotoraptor` action only supports pull requests');
    }

    const pr = github.context.payload.pull_request.number;
    const owner = github.context.repo.owner;
    const repo = github.context.repo.repo;
    const token = core.getInput("github-token", { required: true });
    const ok = github.getOctokit(token);

    const filenames = await getChangedCFiles(ok, owner, repo, pr);
    const gotos = await runClangTidy(filenames);

    core.info(gotos)

    core.setOutput('gotos', 'True');
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
