// GitHub and GitHub Actions stuff
import * as core from "@actions/core";
import * as github from "@actions/github";
import { Octokit } from "@octokit/core";
import { Endpoints } from "@octokit/types";

// Stuff to parse patches to find added gotos
import { Hunk, ParsedDiff, parsePatch } from "diff";

// The Hunk type from "diff" doesn't keep track of the file, but we need that.
export interface FileHunk extends Hunk {
  filename: string;
}

// used in octokit.checks.create()
// https://docs.github.com/rest/reference/checks#create-a-check-run
export type ChecksCreateParams = Endpoints["POST /repos/{owner}/{repo}/check-runs"]["parameters"];
export type ChecksCreateResponse = Endpoints["POST /repos/{owner}/{repo}/check-runs"]["response"];

// used in octokit.checks.update()
// https://docs.github.com/rest/reference/checks#update-a-check-run
export type ChecksUpdateParams = Endpoints["PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}"]["parameters"];
export type ChecksUpdateResponse = Endpoints["PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}"]["response"];

// used in octokit.pulls.listFiles()
// https://docs.github.com/rest/reference/pulls#list-pull-requests-files
export type PullsListFilesParams = Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}/files"]["parameters"];
export type PullsListFilesResponse = Endpoints["GET /repos/{owner}/{repo}/pulls/{pull_number}/files"]["response"];

// used in octokit.repos.getCommit()
// https://docs.github.com/rest/reference/repos#get-a-commit
export type ReposGetCommitParams = Endpoints["GET /repos/{owner}/{repo}/commits/{ref}"]["parameters"];
export type ReposGetCommitResponse = Endpoints["GET /repos/{owner}/{repo}/commits/{ref}"]["response"];

// Basically a way to contain global variables in one object, so that custom
// values can be injected into the main function for testing.
// In production these inputs are read in from the environment.
export interface MyContext {
  owner: string;
  repo: string;
  is_pr: boolean;
  pull_number?: number;
  sha: string;
  octokit: Octokit;
}

export function loadContext(): MyContext {
  const is_pr = github.context.eventName == "pull_request";
  const token = core.getInput("github-token", { required: true });
  return {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    is_pr: is_pr,
    pull_number: is_pr
      ? github.context.payload.pull_request?.number
      : undefined,
    // If we're on a PR, use the sha from the payload to prevent Ghost Check Runs
    // from https://github.com/IgnusG/jest-report-action/blob/de40d98e24f18a77e637762c8d2a1751edfbcc44/tasks/github-api.js#L3
    sha: is_pr
      ? github.context.payload.pull_request?.head.sha
      : github.context.sha,
    octokit: github.getOctokit(token),
  };
}

// Info about one file changed in a commit or in a PR.
export interface File {
  filename: string;
  // The possible values of GitHub file statuses per
  // https://github.com/jitterbit/get-changed-files/blob/b17fbb00bdc0c0f63fcf166580804b4d2cdc2a42/src/main.ts#L5
  // status: "added" | "modified" | "removed" | "renamed";
  status: string;
  patch?: string;
}

async function getChangedCFiles(context: MyContext): Promise<File[]> {
  let files: File[];
  if (context.is_pr) {
    // See https://docs.github.com/en/free-pro-team@latest/rest/reference/pulls#list-pull-requests-files
    const params: PullsListFilesParams = {
      owner: context.owner,
      repo: context.repo,
      pull_number: context.pull_number as number,
      page: 0,
      per_page: 300,
    };
    const response: PullsListFilesResponse = await context.octokit.pulls.listFiles(
      params
    );
    files = response.data;
  } else {
    // See https://docs.github.com/en/free-pro-team@latest/rest/reference/repos#get-a-commit
    const params: ReposGetCommitParams = {
      owner: context.owner,
      repo: context.repo,
      ref: context.sha,
    };
    const response: ReposGetCommitResponse = await context.octokit.repos.getCommit(
      params
    );
    if (response.data.files) {
      files = response.data.files as File[];
    } else {
      files = [];
    }
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

// Annotation for each goto added, sent to GitHub as part of a `check`.
// See https://docs.github.com/rest/reference/checks#create-a-check-run
export interface Annotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: "notice" | "warning" | "failure";
  message: string;
  title: string;
}

export function hunksInFile(file: File): FileHunk[] {
  core.debug(`Finding Hunks in File: ${JSON.stringify(file)}`);
  if (!file.patch) {
    return [];
  }
  core.debug(`patch for this File: ${JSON.stringify(file.patch)}`);
  const diffs: ParsedDiff[] = parsePatch(file.patch);
  // Since this is for a single file, there's only one diff in this patch.
  const firstAndOnlyDiff = diffs[0];
  const hunks: Hunk[] = firstAndOnlyDiff.hunks;

  let result: FileHunk[] = [];
  hunks.forEach((hunk) => {
    const fh: FileHunk = {
      ...hunk,
      filename: file.filename,
    };
    result.push(fh);
  });
  core.debug(`Found these Hunks for this File: ${JSON.stringify(result)}`);
  return result;
}

export function containsGoto(line: string): boolean {
  // [either start of line or semicolon], 0+ whitespace, goto, 1+ whitespace,
  // 1+ word characters (this is the symbol to go to), 0+ whitespace, semicolon
  const regex = /(^|;)\s*goto\s+\w+\s*;/;
  return regex.test(line);
}

export function gotosInHunk(hunk: FileHunk): Annotation[] {
  let annotations: Annotation[] = [];
  let lineNumber = hunk.newStart;
  core.debug(`Finding Gotos in Hunk: ${JSON.stringify(hunk)}`);
  hunk.lines.forEach((line) => {
    const lineAdded = line.startsWith("+");
    if (lineAdded && containsGoto(line.substring(1))) {
      annotations.push({
        path: hunk.filename,
        start_line: lineNumber,
        end_line: lineNumber,
        annotation_level: "warning",
        title: "Watch out for velociraptors!",
        message: "A goto was added! See xkcd.com/292",
      });
    }
    // All lines that weren't removed either were unchanged or added,
    // and therefore exist in the new file.
    if (!line.startsWith("-")) {
      lineNumber += 1;
    }
  });
  core.debug(`Found these Gotos: ${JSON.stringify(annotations)}`);
  return annotations;
}

export function getAnnotations(files: File[]): Annotation[] {
  const hunks: FileHunk[] = [];
  files.forEach((file) => {
    hunks.push(...hunksInFile(file));
  });
  let annotations: Annotation[] = [];
  hunks.forEach((hunk) => {
    annotations.push(...gotosInHunk(hunk));
  });
  return annotations;
}

async function sendInitialCheck(context: MyContext): Promise<number> {
  const params: ChecksCreateParams = {
    owner: context.owner,
    repo: context.repo,
    head_sha: context.sha,
    name: "Goto Velociraptor Check",
    status: "in_progress",
    started_at: new Date(Date.now()).toISOString(),
  };
  const check: ChecksCreateResponse = await context.octokit.checks.create(
    params
  );
  core.debug(`Check ID is ${check.data.id}`);
  return check.data.id;
}

interface Result {
  conclusion: "success" | "failure";
  output: {
    title: string;
    summary: string;
    annotations?: Annotation[];
  };
}

function makeResult(annotations: Annotation[]): Result {
  core.debug(`gotos: ${JSON.stringify(annotations)}`);
  if (annotations.length == 0) {
    core.setOutput("gotos", "False");
    return {
      conclusion: "success",
      output: {
        title: "No gotos added.",
        summary:
          "You got away this time. See [relevant xkcd comic](https://xkcd.com/292):\n\n![https://xkcd.com/292](https://imgs.xkcd.com/comics/goto.png)",
      },
    };
  } else {
    core.setOutput("gotos", "True");
    return {
      conclusion: "failure",
      output: {
        title: "Velociraptors incoming!",
        summary:
          "![velociraptor meme](https://i.imgur.com/wV7InR8.gif)\n\nThat's what happens when you add gotos! See [relevant xkcd comic](https://xkcd.com/292):\n\n![https://xkcd.com/292](https://imgs.xkcd.com/comics/goto.png)\n\nSpecific guilty lines are annotated. If something is a mistake, please file an issue against this [action](https://github.com/NickCrews/gotoraptor/issues/new).",
        annotations: annotations,
      },
    };
  }
}

async function completeCheck(
  context: MyContext,
  check_id: number,
  result: Result
) {
  const options: ChecksUpdateParams = {
    owner: context.owner,
    repo: context.repo,
    check_run_id: check_id,
    status: "completed",
    conclusion: result.conclusion,
    completed_at: new Date(Date.now()).toISOString(),
    output: result.output,
  };
  core.debug(`Check update request options: ${JSON.stringify(options)}`);
  await context.octokit.checks.update(options);
  core.debug(`Successfully completed check.`);
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

export async function run(context: MyContext): Promise<void> {
  core.debug(JSON.stringify(context));
  core.debug(`Running on a ${context.is_pr ? "PR" : "push"} event.`);
  const check_id = await sendInitialCheck(context);
  try {
    const files: File[] = await getChangedCFiles(context);
    const annotations = getAnnotations(files);
    const result = makeResult(annotations);
    await completeCheck(context, check_id, result);
  } catch (error) {
    core.setFailed(error.message);
    core.error(error.stack);
    await completeCheck(context, check_id, ERROR_RESULT);
    process.exit(1);
  }
}
