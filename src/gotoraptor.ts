// docs.github.com/v3/checks

import * as path from "path";
import * as proc from "child_process";

import * as core from "@actions/core";
import * as github from "@actions/github";
import { Octokit } from "@octokit/core";
import { Endpoints } from "@octokit/types";

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

const clang_tools_bin_dir = require("clang-tools-prebuilt");

const CHECK_NAME = "Goto Velociraptor Check";

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
  return child.stdout.toString();
}

async function sendInitialCheck(context: MyContext): Promise<number> {
  const params: ChecksCreateParams = {
    owner: context.owner,
    repo: context.repo,
    head_sha: context.sha,
    name: CHECK_NAME,
    status: "in_progress",
    started_at: new Date().toISOString(),
  };
  const check: ChecksCreateResponse = await context.octokit.checks.create(
    params
  );
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

async function getAnnotations(context: MyContext): Promise<Annotation[]> {
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
    completed_at: new Date().toISOString(),
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
    const annotations = await getAnnotations(context);
    const result = makeResult(annotations);
    await completeCheck(context, check_id, result);
  } catch (error) {
    core.setFailed(error.message);
    core.error(error.stack);
    await completeCheck(context, check_id, ERROR_RESULT);
    process.exit(1);
  }
}
