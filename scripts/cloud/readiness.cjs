function waitForSsm({ instanceId, region, read, sleep, report = () => {}, attempts = 30 }) {
  let previous;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const node = read().find(item => item.InstanceId === instanceId);
    const status = node?.PingStatus || 'not registered';
    if (status === 'Online') return;
    if (status !== previous) {
      report(`Waiting for SSM: ${instanceId} in ${region} is ${status}.`);
      previous = status;
    }
    if (attempt + 1 < attempts) sleep();
  }
  throw new Error(`SSM is not Online for ${instanceId} in ${region}. Confirm its IAM role, agent and network access in Systems Manager before retrying. No deployment command was submitted.`);
}
module.exports = { waitForSsm };
