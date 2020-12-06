const core = require('@actions/core');
const github = require('@actions/github');

async function run() {
  try {
    const token = core.getInput("github-token", { required: true });

    const { pull_request: pr } = github.context.payload;
    if (!pr) {
      throw new Error("Event payload missing `pull_request`");
    }

    const ok = github.getOctokit(token);
    core.debug(`Sending velociraptors to pull request #${pr.number}`);
    // await ok.pulls.createReviewComment({
    await ok.issues.createComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      // pull_number: pr.number,
      issue_number: pr.number,
      body: 'YOU ADDED A GOTO'
    });
    core.debug(`Sent velociraptors to pull request #${pr.number}`);
    core.setOutput('gotos', 'True');
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
