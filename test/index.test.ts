// import * as cp from 'child_process'
// import * as path from 'path'

// shows how the runner will run a javascript action with env / stdout protocol
// test('test runs', () => {
//   const env = {
//     INPUT_GITHUB_TOKEN: 'MOCK_TOKEN',
//   };
//   const np = process.execPath
//   const ip = path.join(__dirname, "..", "dist", 'index.js');
//   const options: cp.ExecFileSyncOptions = {
//     env: env
//   }
//   console.log(cp.execFileSync(np, [ip], options).toString())
// })

const { Octokit } = require("@octokit/core");

import * as gtr from "../src/gotoraptor";

const MOCK_OWNER = "mockowner";
const MOCK_REPO = "mockrepo";
const MOCK_PULL_NUMBER = 42;
const MOCK_SHA = "0123456789abcdef0123456789abcdef01234567";
const MOCK_CHECK_ID = 123;

class Mocktokit extends Octokit {
  pulls = {
    listFiles: jest.fn(),
  };
  checks = {
    create: jest.fn(),
    update: jest.fn(),
  };
  repos = {
    getCommit: jest.fn(),
  };
}
const mocktokit = new Mocktokit();

beforeEach(() => {
  mocktokit.pulls.listFiles.mockClear();
  mocktokit.checks.create.mockClear();
  mocktokit.checks.update.mockClear();
  mocktokit.repos.getCommit.mockClear();
});

test("dummy", () => {
  expect(true).toBe(true);
});

test("e2e with file-less PR", async () => {
  mocktokit.pulls.listFiles.mockReturnValueOnce({
    // TODO: somehow this doesn't crash the program, but it should.
    data: [{ filename: "bob" }, "hi", 4],
  });
  mocktokit.checks.create.mockReturnValueOnce({
    data: {
      id: MOCK_CHECK_ID,
    },
  });
  const ctx: gtr.MyContext = {
    owner: MOCK_OWNER,
    repo: MOCK_REPO,
    is_pr: true,
    pull_number: MOCK_PULL_NUMBER,
    sha: MOCK_SHA,
    octokit: mocktokit,
  };
  await gtr.run(ctx);

  expect(mocktokit.checks.create.mock.calls).toHaveLength(1);
  const createCheckArgs = mocktokit.checks.create.mock.calls[0][0];
  expect(createCheckArgs.owner).toEqual(MOCK_OWNER);
  expect(createCheckArgs.repo).toEqual(MOCK_REPO);
  expect(createCheckArgs.head_sha).toEqual(MOCK_SHA);
  expect(createCheckArgs.name).toEqual("Goto Velociraptor Check");
  expect(createCheckArgs.status).toEqual("in_progress");

  expect(mocktokit.repos.getCommit.mock.calls).toHaveLength(0);

  expect(mocktokit.pulls.listFiles.mock.calls).toHaveLength(1);
  const pullsListFilesArgs = mocktokit.pulls.listFiles.mock.calls[0][0];
  expect(pullsListFilesArgs.owner).toEqual(MOCK_OWNER);
  expect(pullsListFilesArgs.repo).toEqual(MOCK_REPO);
  expect(pullsListFilesArgs.pull_number).toEqual(MOCK_PULL_NUMBER);
  expect(pullsListFilesArgs.page).toEqual(0);
  expect(pullsListFilesArgs.per_page).toEqual(300);

  expect(mocktokit.checks.update.mock.calls).toHaveLength(1);
  const completeCheckArgs = mocktokit.checks.update.mock.calls[0][0];
  expect(completeCheckArgs.owner).toEqual(MOCK_OWNER);
  expect(completeCheckArgs.repo).toEqual(MOCK_REPO);
  expect(completeCheckArgs.check_run_id).toEqual(MOCK_CHECK_ID);
  expect(completeCheckArgs.status).toEqual("completed");
  expect(completeCheckArgs.conclusion).toEqual("success");
  expect(completeCheckArgs.output).toEqual({
    title: "No gotos added.",
    summary: "You got away this time.",
  });
  // TODO: check that @actions/core.setOutput('false') was called
});
