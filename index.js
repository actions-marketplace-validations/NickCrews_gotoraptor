const core = require('@actions/core');
const github = require('@actions/github');
const wait = require('./wait');


// most @actions toolkit packages have async methods
async function run() {
  try {
    // const token = core.getInput('GITHUB_TOKEN');
    core.info(github.context)
    // Available in the build.yml, how to get it here...
    // const pr = ${{github.event.number}};

    const ms = core.getInput('milliseconds');
    core.info(`Waiting ${ms} milliseconds ...`);

    core.debug((new Date()).toTimeString()); // debug is only output if you set the secret `ACTIONS_RUNNER_DEBUG` to true
    await wait(parseInt(ms));
    core.info((new Date()).toTimeString());

    core.setOutput('time', new Date().toTimeString());
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
