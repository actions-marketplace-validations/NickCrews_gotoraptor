// docs.github.com/v3/checks

const path = require("path");
const proc = require("child_process");

const core = require("@actions/core");
const github = require("@actions/github");

const TOKEN = core.getInput("github-token", { required: true });
const octokit = github.getOctokit(TOKEN);

const clang_tools_bin_dir = require("clang-tools-prebuilt");

const CHECK_NAME = "Goto Velociraptor Check";

interface File {
  filename: string;
  // The possible values of GitHub file statuses per
  // https://github.com/jitterbit/get-changed-files/blob/b17fbb00bdc0c0f63fcf166580804b4d2cdc2a42/src/main.ts#L5
  status: "added" | "modified" | "removed" | "renamed";
}

interface MyContext {
  owner: string;
  repo: string;
  is_pr: boolean;
  pull_number: number;
  sha: string;
}

function loadContext(): MyContext {
  const is_pr = github.context.eventName == "pull_request";
  return {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    is_pr: is_pr,
    pull_number: is_pr ? github.context.payload.pull_request.number : undefined,
    // If we're on a PR, use the sha from the payload to prevent Ghost Check Runs
    // from https://github.com/IgnusG/jest-report-action/blob/de40d98e24f18a77e637762c8d2a1751edfbcc44/tasks/github-api.js#L3
    sha: is_pr
      ? github.context.payload.pull_request.head.sha
      : github.context.sha,
  };
}

async function getChangedCFiles(context: MyContext): Promise<File[]> {
  let files;
  if (context.is_pr) {
    // See https://docs.github.com/en/free-pro-team@latest/rest/reference/pulls#list-pull-requests-files
    const response = await octokit.pulls.listFiles({
      owner: context.owner,
      repo: context.repo,
      pull_number: context.pull_number,
      page: 0,
      per_page: 300,
    });
    files = response.data as File[];
  } else {
    // See https://docs.github.com/en/free-pro-team@latest/rest/reference/repos#get-a-commit
    const response = await octokit.repos.getCommit({
      owner: context.owner,
      repo: context.repo,
      ref: context.sha,
    });
    files = response.data.files as File[];
  }
  core.debug(`All touched files: ${files.map((f) => f.filename)}`);
  // The possible values of GitHub file statuses per
  // https://github.com/jitterbit/get-changed-files/blob/b17fbb00bdc0c0f63fcf166580804b4d2cdc2a42/src/main.ts#L5
  // type FileStatus = 'added' | 'modified' | 'removed' | 'renamed'
  const changedStatuses = ["added", "modified", "renamed"];
  const changedFiles = files.filter((f) => changedStatuses.includes(f.status));
  core.debug(`Files with changes: ${changedFiles.map((f) => f.filename)}`);
  // regex for c, cc, h, hpp
  const pattern = /.*\.[ch](p{2})?$/;
  const changedCFiles = changedFiles.filter((f) => f.filename.match(pattern));
  core.debug(`Changed C/C++ files: ${changedCFiles.map((f) => f.filename)}`);
  return changedCFiles;
}

function runClangTidy(filenames: string[]): string {
  const clang_tidy_path = path.join(clang_tools_bin_dir, "clang-tidy");
  const { GITHUB_WORKSPACE } = process.env;
  const args = process.argv
    .slice(2)
    .concat("-checks=-*,cppcoreguidelines-avoid-goto")
    .concat(filenames);
  core.debug(`clang-tidy args: ${args}`);
  const child = proc.spawnSync(clang_tidy_path, args, {
    stdio: "inherit",
    cwd: GITHUB_WORKSPACE,
    timeout: 30 * 1000,
  });
  core.debug(`Ran clang-tidy: ${JSON.stringify(child)}`);
  if (child.status) {
    throw new Error(`clang-tidy failed: ${JSON.stringify(child)}`);
  }
  core.debug(`clang-tidy stdout: ${child.stdout}`);
  return child.stdout;
}

async function sendInitialCheck(context: MyContext): Promise<number> {
  const check = await octokit.checks.create({
    owner: context.owner,
    repo: context.repo,
    head_sha: context.sha,
    name: CHECK_NAME,
    status: "in_progress",
    started_at: new Date(),
  });
  core.debug(`Check ID is ${check.data.id}`);
  return check.data.id;
}

const VELOCIRAPTOR_MEME_URLS = ["https://i.imgur.com/wV7InR8.gif"];

interface Image {
  alt: string;
  image_url: string;
  caption?: string;
}

function getVelociraptorMemes(): Image[] {
  return VELOCIRAPTOR_MEME_URLS.map((url) => {
    return {
      image_url: url,
      alt: "velociraptor meme",
    };
  });
}

async function getAddedGotos(context: MyContext): Promise<Goto[]> {
  const files: File[] = await getChangedCFiles(context);
  if (files.length == 0) {
    return [];
  }
  runClangTidy(files.map((f) => f.filename));
  return [];
}

interface Result {
  conclusion: "success" | "failure";
  output: {
    title: string;
    summary: string;
    images?: Image[];
    annotations?: {
      path: string;
      start_line: number;
      end_line: number;
      /**
       * The start column of the annotation. Annotations only support `start_column` and `end_column` on the same line. Omit this parameter if `start_line` and `end_line` have different values.
       */
      start_column?: number;
      end_column?: number;
      annotation_level: "notice" | "warning" | "failure";
      message: string;
      title?: string;
      raw_details?: string;
    }[];
  };
}

interface Goto {
  path: string;
  start_line: number;
  end_line: number;
}

function makeResult(gotos: Goto[]): Result {
  core.debug(`gotos: ${JSON.stringify(gotos)}`);
  if (gotos.length == 0) {
    core.setOutput("gotos", "False");
    return {
      conclusion: "success",
      output: {
        title: "No gotos added.",
        summary: "You got away this time.",
      },
    };
  } else {
    core.setOutput("gotos", "True");
    return {
      conclusion: "failure",
      output: {
        title: "Velociraptors incoming!",
        summary: "gotos were added!",
        images: getVelociraptorMemes().slice(0, 1),
        annotations: [],
      },
    };
  }
}

async function completeCheck(
  context: MyContext,
  check_id: number,
  result: Result
) {
  const options = {
    owner: context.owner,
    repo: context.repo,
    check_run_id: check_id,
    status: "completed",
    conclusion: result.conclusion,
    completed_at: new Date(),
    output: result.output,
  };
  core.debug(`Check update request options: ${JSON.stringify(options)}`);
  await octokit.checks.update(options);
}

const ERROR_SUMMARY = `Something went wrong internally in the check.

Please file an issue against this [action](https://github.com/NickCrews/gotoraptor/issues/new)`;

const ERROR_RESULT: Result = {
  conclusion: "failure",
  output: {
    title: "The check errored",
    summary: ERROR_SUMMARY,
  },
};

async function run(context: MyContext) {
  core.debug(JSON.stringify(context));
  core.debug(`Running on a ${context.is_pr ? "PR" : "push"} event.`);
  const check_id = await sendInitialCheck(context);
  try {
    const gotos = await getAddedGotos(context);
    const result = makeResult(gotos);
    await completeCheck(context, check_id, result);
  } catch (error) {
    core.setFailed(error.message);
    core.error(error.stack);
    await completeCheck(context, check_id, ERROR_RESULT);
    process.exit(1);
  }
}

run(loadContext());
