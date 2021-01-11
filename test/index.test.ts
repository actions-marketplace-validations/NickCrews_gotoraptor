import * as core from "@actions/core";
import { Octokit } from "@octokit/core";

import * as gtr from "../src/gotoraptor";

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
        title: "Watch out for velociraptors!",
        message: "A goto was added! See xkcd.com/292",
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
        title: "Watch out for velociraptors!",
        message: "A goto was added! See xkcd.com/292",
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
        title: "Watch out for velociraptors!",
        message: "A goto was added! See xkcd.com/292",
      },
      {
        path: "file1.c",
        start_line: 2,
        end_line: 2,
        annotation_level: "warning",
        title: "Watch out for velociraptors!",
        message: "A goto was added! See xkcd.com/292",
      },
      {
        path: "file2.c",
        start_line: 3,
        end_line: 3,
        annotation_level: "warning",
        title: "Watch out for velociraptors!",
        message: "A goto was added! See xkcd.com/292",
      },
    ];
    expect(gtr.getAnnotations(files)).toEqual(expectedAnnotations);
  });
});

describe("e2e tests", () => {
  const MOCK_OWNER = "mockowner";
  const MOCK_REPO = "mockrepo";
  const MOCK_PULL_NUMBER = 42;
  const MOCK_SHA = "0123456789abcdef0123456789abcdef01234567";
  const MOCK_CHECK_ID = 123;
  const MOCK_CHECK_START_TIME = new Date("2020-01-01T00:00:00.000Z");
  const MOCK_CHECK_UPDATE_TIME = new Date("2020-01-01T00:00:10.000Z");

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

  mocktokit.checks.create.mockReturnValue({
    data: {
      id: MOCK_CHECK_ID,
    },
  });

  const coreSetOutput = jest.spyOn(core, "setOutput");

  beforeEach(() => {
    jest.clearAllMocks();
    // In app code we call Date.now twice. The first time when sending the
    // initial check, and again when updating the check.
    jest
      .spyOn(global.Date, "now")
      .mockReturnValueOnce(MOCK_CHECK_START_TIME.valueOf())
      .mockReturnValueOnce(MOCK_CHECK_UPDATE_TIME.valueOf());
  });

  it("Finds no warnings on PR with only an ignored txt file", async () => {
    mocktokit.pulls.listFiles.mockReturnValueOnce({
      // This doesn't strictly match the return type of the real
      // ocktokit.pulls.listFiles, but it's OK
      data: [{ filename: "ignored.txt", status: "modified" }],
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

    // Should send initial request to GitHub to create a Check.
    expect(mocktokit.checks.create).toHaveBeenCalledTimes(1);
    expect(mocktokit.checks.create).toHaveBeenCalledWith({
      owner: MOCK_OWNER,
      repo: MOCK_REPO,
      head_sha: MOCK_SHA,
      name: "Goto Velociraptor Check",
      status: "in_progress",
      started_at: MOCK_CHECK_START_TIME.toISOString(),
    });

    // It's a PR, so we shouldn't have requested a specific commit.
    expect(mocktokit.repos.getCommit).toHaveBeenCalledTimes(0);

    // Should have requested info about a PR.
    expect(mocktokit.pulls.listFiles).toHaveBeenCalledTimes(1);
    expect(mocktokit.pulls.listFiles).toHaveBeenCalledWith({
      owner: MOCK_OWNER,
      repo: MOCK_REPO,
      pull_number: MOCK_PULL_NUMBER,
      page: 0,
      per_page: 300,
    });

    // Should have completed our earlier check.
    expect(mocktokit.checks.update).toHaveBeenCalledTimes(1);
    expect(mocktokit.checks.update).toHaveBeenCalledWith({
      owner: MOCK_OWNER,
      repo: MOCK_REPO,
      check_run_id: MOCK_CHECK_ID,
      status: "completed",
      conclusion: "success",
      completed_at: MOCK_CHECK_UPDATE_TIME.toISOString(),
      output: {
        title: "No gotos added.",
        summary:
          "You got away this time. See [relevant xkcd comic](https://xkcd.com/292):\n\n![https://xkcd.com/292](https://imgs.xkcd.com/comics/goto.png)",
      },
    });

    expect(coreSetOutput).toHaveBeenCalledTimes(1);
    expect(coreSetOutput).toHaveBeenCalledWith("gotos", "False");
  });
});
