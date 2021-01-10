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

import { Octokit } from "@octokit/core";

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

describe("hunksInFile() unit tests", () => {
  it("Extracts FileHunks from File", () => {
    const file: gtr.File = {
      filename: "addedgoto.c",
      status: "added",
      patch: "@@ -0,0 +1,3 @@\n+int main () {\n+   return 0;\n+}",
    };
    const expectedHunks: gtr.FileHunk[] = [
      {
        filename: "addedgoto.c",
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 3,
        lines: ["+int main () {", "+   return 0;", "+}"],
        linedelimiters: ["\n", "\n", "\n"],
      },
    ];
    expect(gtr.hunksInFile(file)).toEqual(expectedHunks);
  });

  it("Ignores File with missing patch", () => {
    const file: gtr.File = {
      filename: "addedgoto.c",
      status: "added",
    };
    expect(gtr.hunksInFile(file)).toEqual([]);
  });
});

describe("containsGoto() unit tests", () => {
  it("Finds GoTo", () => {
    expect(gtr.containsGoto("goto SYMBOL2;")).toBe(true);
  });

  it("Finds GoTo with spaces", () => {
    expect(gtr.containsGoto("  goto SYMBOL ;")).toBe(true);
  });

  it("Finds GoTo with tabs", () => {
    expect(gtr.containsGoto("\t\tgoto\tSYMBOL\t;")).toBe(true);
  });

  it("Finds GoTo with stuff after semicolon", () => {
    expect(gtr.containsGoto("goto SYMBOL; //comment")).toBe(true);
  });

  it("Finds GoTo as second statement on line", () => {
    expect(gtr.containsGoto("x++; goto SYMBOL;")).toBe(true);
  });

  it("Misses GoTo with no symbol", () => {
    expect(gtr.containsGoto("goto")).toBe(false);
  });

  it("Misses GoTo with multiple symbols", () => {
    expect(gtr.containsGoto("goto symbol1 symbol2")).toBe(false);
  });

  it("Misses GoTo with missing semicolon", () => {
    expect(gtr.containsGoto("goto symbol1")).toBe(false);
  });

  it("Misses GoTo with preceding non-whitespace", () => {
    expect(gtr.containsGoto("int goto = 5;")).toBe(false);
  });

  it("Misses GoTo with no following symbol", () => {
    expect(gtr.containsGoto("  goto ")).toBe(false);
  });

  it("Misses malformed GoTo", () => {
    expect(gtr.containsGoto("  gotosymbol adas")).toBe(false);
  });

  it("Misses commented GoTo", () => {
    expect(gtr.containsGoto("// goto symbol;")).toBe(false);
  });
});

describe("gotosInHunk() unit tests", () => {
  it("Makes annotation from hunk with added goto", () => {
    const hunk: gtr.FileHunk = {
      filename: "filename",
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 23,
      lines: [
        "+#include <stdio.h>",
        "+ ",
        "+int main () {",
        "+",
        "+   /* local variable definition */",
        "+   int a = 10;",
        "+",
        "+   /* do loop execution */",
        "+   LOOP:do {",
        "+   ",
        "+      if( a == 15) {",
        "+         /* skip the iteration */",
        "+         a = a + 1;",
        "+         goto LOOP;",
        "+      }",
        "+\t\t",
        '+      printf("value of a: %d\\n", a);',
        "+      a++;",
        "+",
        "+   }while( a < 20 );",
        "+ ",
        "+   return 0;",
        "+}",
      ],
      linedelimiters: [
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
      ],
    };

    const expectedAnnotations: gtr.Annotation[] = [
      {
        path: "filename",
        start_line: 14,
        end_line: 14,
        annotation_level: "warning",
        title: "A goto was added!",
        message: "Watch out for velociraptors! xckcd.com/292",
      },
    ];
    expect(gtr.gotosInHunk(hunk)).toEqual(expectedAnnotations);
  });

  it("Makes annotation from hunk with added goto, with complex edits", () => {
    // Example hunk from require('diff').parsePatch(patchstring)
    // It contains an added goto at line 12
    // This contains some unchanged and deleted lines, so make sure we count our
    // goto location correctly.
    const hunk: gtr.FileHunk = {
      filename: "filename",
      oldStart: 1,
      oldLines: 13,
      newStart: 1,
      newLines: 15,
      lines: [
        "#include <stdio.h>",
        "-",
        "int main () {",
        "",
        "-   /* local variable definition */",
        "   int a = 10;",
        "",
        "   /* do loop execution */",
        "   LOOP:do {",
        "   ",
        "+      if( a == 15) {",
        "+         /* skip the iteration */",
        "+         a = a + 1;",
        "+         goto LOOP;",
        "      }",
        "\t\t",
        '      printf("value of a: %d\\n", a);',
      ],
      linedelimiters: [
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
      ],
    };

    const expectedAnnotations: gtr.Annotation[] = [
      {
        path: "filename",
        start_line: 12,
        end_line: 12,
        annotation_level: "warning",
        title: "A goto was added!",
        message: "Watch out for velociraptors! xckcd.com/292",
      },
    ];
    expect(gtr.gotosInHunk(hunk)).toEqual(expectedAnnotations);
  });

  it("Ignores hunk with existing goto", () => {
    // Example hunk from require('diff').parsePatch(patchstring)
    // It contains an unchanged goto at line 14
    const hunk: gtr.FileHunk = {
      filename: "filename",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 23,
      lines: [
        "+#include <stdio.h>",
        "+ ",
        "+int main () {",
        "+",
        "+   /* local variable definition */",
        "+   int a = 10;",
        "+",
        "+   /* do loop execution */",
        "+   LOOP:do {",
        "+   ",
        "+      if( a == 15) {",
        "+         /* skip the iteration */",
        "+         a = a + 1;",
        "          goto LOOP;",
        "+      }",
        "+\t\t",
        '+      printf("value of a: %d\\n", a);',
        "+      a++;",
        "+",
        "+   }while( a < 20 );",
        "+ ",
        "+   return 0;",
        "+}",
      ],
      linedelimiters: [
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
        "\n",
      ],
    };
    expect(gtr.gotosInHunk(hunk)).toEqual([]);
  });
});

describe("getAnnotations() unit tests", () => {
  it("Returns nothing when given no files", () => {
    expect(gtr.getAnnotations([])).toEqual([]);
  });

  it("Returns multiple annotations from multiple files", () => {
    const files: gtr.File[] = [
      {
        filename: "file1.c",
        status: "added",
        patch: "@@ -0,0 +1,2 @@\n+goto one;\n+goto two;",
      },
      {
        filename: "file2.c",
        status: "modified",
        patch: "@@ -0,0 +1,3 @@\n\n\n+goto three;",
      },
    ];
    const expectedAnnotations: gtr.Annotation[] = [
      {
        path: "file1.c",
        start_line: 1,
        end_line: 1,
        annotation_level: "warning",
        title: "A goto was added!",
        message: "Watch out for velociraptors! xckcd.com/292",
      },
      {
        path: "file1.c",
        start_line: 2,
        end_line: 2,
        annotation_level: "warning",
        title: "A goto was added!",
        message: "Watch out for velociraptors! xckcd.com/292",
      },
      {
        path: "file2.c",
        start_line: 3,
        end_line: 3,
        annotation_level: "warning",
        title: "A goto was added!",
        message: "Watch out for velociraptors! xckcd.com/292",
      },
    ];
    expect(gtr.getAnnotations(files)).toEqual(expectedAnnotations);
  });
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
