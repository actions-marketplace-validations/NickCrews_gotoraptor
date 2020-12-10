// docs.github.com/v3/checks

const path = require('path');
const proc = require('child_process');

const core = require('@actions/core');
const github = require('@actions/github');

const { GITHUB_WORKSPACE } = process.env;
const TOKEN = core.getInput("github-token", { required: true });
const octokit = github.getOctokit(TOKEN);

// const clang_tools_bin_dir = require('clang-tools-prebuilt');

const CHECK_NAME = 'Goto Velociraptor Check'

async function getChangedCFiles() {
  if (isPR()) {
    // See https://docs.github.com/en/free-pro-team@latest/rest/reference/pulls#list-pull-requests-files
    const response = await octokit.pulls.listFiles({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: github.context.payload.pull_request.number,
      page: 0,
      per_page: 300
    });
    const files = response.data;
  } else {
    // See https://docs.github.com/en/free-pro-team@latest/rest/reference/repos#get-a-commit
    const response = await octokit.repos.getCommit({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      ref: getHeadSHA()
    });
    const files = response.data.files;
  }
  core.debug(`All touched files: ${files.map(f => f.filename)}`);
  // The possible values of GitHub file statuses per
  // https://github.com/jitterbit/get-changed-files/blob/b17fbb00bdc0c0f63fcf166580804b4d2cdc2a42/src/main.ts#L5
  // type FileStatus = 'added' | 'modified' | 'removed' | 'renamed'
  const changedStatuses = ['added', 'modified', 'renamed'];
  const changedFiles = files.filter(f => changedStatuses.contains(f.status));
  core.debug(`Files with changes: ${changedFiles.map(f => f.filename)}`);
  // regex for c, cc, h, hpp
  const pattern = /.*\.[ch](p{2})?$/;
  const changedCFiles = changedFiles.filter(f => f.filename.match(pattern));
  core.debug(`Changed C/C++ files ${changedCFiles.map(f => f.filename)}`)
  return changedCFiles
}

function runClangTidy(filenames) {
    const clang_tidy_path = path.join(clang_tools_bin_dir, 'clang-tidy');
    const { GITHUB_WORKSPACE } = process.env;
    const args = process.argv.slice(2)
        .concat('-checks=-*,cppcoreguidelines-avoid-goto')
        .concat(filenames);
    const child = proc.spawnSync(clang_tidy_path, args, {
        stdio: 'inherit',
        cwd: GITHUB_WORKSPACE,
        timeout: 30 * 1000
    });
    core.debug(`Ran clang-tidy: ${JSON.stringify(child)}`);
    if (child.status) {
      throw new Error(`clang-tidy failed: ${JSON.stringify(child)}`);
    }
    core.debug(`clang-tidy stdout: ${child.stdout}`);
    return child.stdout;
}

function isPR() {
  return Boolean(github.context.payload.pull_request)
}

// If we're on a PR, use the sha from the payload to prevent Ghost Check Runs
// from https://github.com/IgnusG/jest-report-action/blob/de40d98e24f18a77e637762c8d2a1751edfbcc44/tasks/github-api.js#L3
function getHeadSHA() {
  if (isPR()) {
    return github.context.payload.pull_request.head.sha;
  }
  return github.context.sha;
}

async function sendInitialCheck() {
  const check = await octokit.checks.create({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    head_sha: getHeadSHA(),
    name: CHECK_NAME,
    status: "in_progress",
    started_at: new Date()
  });
  core.debug(`Check ID is ${check.data.id}`);
  return check.data.id;
}

const VELOCIRAPTOR_MEME_URLS = [
  'https://i.imgur.com/wV7InR8.gif'
]

function getVelociraptorMemes() {
 return VELOCIRAPTOR_MEME_URLS.map(url => {
   return {
     image_url: url,
     alt: 'velociraptor meme'
   };
  });
}

async function getAddedGotos(){
  const files = await getChangedCFiles();
  const gotos = runClangTidy(files.map(f => f.filename));
  return gotos;
}

function makeResults(gotos) {
  if (gotos.length == 0) {
    core.setOutput('gotos', 'False');
    return {
      conclusion: 'success',
      output: {
        title: "No gotos added.",
        summary: "You got away this time."
      }
    }
  } else {
    core.setOutput('gotos', 'True');
    return {
      conclusion: 'failure',
      output: {
        title: 'Velociraptors incoming!',
        summary: 'gotos were added!',
        images: getVelociraptorMemes().slice(0, 1),
        annotations: []
      }
    }
  }
}

async function completeCheck(check_id, results) {
  const options = {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    check_run_id: check_id,
    status: 'completed',
    conclusion: results.conclusion,
    completed_at: new Date(),
    output: results.output
  }
  core.debug(`Check update request options: ${JSON.stringify(options)}`);
  return await octokit.checks.update(options);
}

const ERROR_SUMMARY = `Something went wrong internally in the check.

Please file an issue against this [action](https://github.com/NickCrews/gotoraptor/issues/new)`

const ERROR_RESULT = {
  conclusion: 'failure',
  output: {
    title: 'The check errored',
    summary: ERROR_SUMMARY
  }
}

async function run() {
  core.debug(JSON.stringify(github.context.payload));
  core.debug(`Running on a ${isPR() ? 'PR' : 'push'} event.`);
  const check_id = await sendInitialCheck();
  try {
    const gotos = await getAddedGotos();
    const results = makeResults(gotos)
    await completeCheck(check_id, results);
  } catch (error) {
    core.setFailed(error.message);
    core.error(error.stack);
    await completeCheck(check_id, ERROR_RESULT);
    process.exit(1);
  }
}

run();
