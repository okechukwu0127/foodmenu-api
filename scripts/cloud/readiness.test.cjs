const { test } = require('node:test');
const assert = require('node:assert/strict');
const { waitForSsm } = require('./readiness.cjs');
const base = { instanceId: 'i-target', region: 'ap-south-1' };
test('online target proceeds immediately', () => {
  waitForSsm({ ...base, read: () => [{ InstanceId: 'i-target', PingStatus: 'Online' }], sleep: () => assert.fail('should not wait') });
});
test('waits through registration and connection propagation', () => {
  const states = [[], [{ InstanceId: 'i-target', PingStatus: 'ConnectionLost' }], [{ InstanceId: 'i-target', PingStatus: 'Online' }]];
  let sleeps = 0;
  waitForSsm({ ...base, read: () => states.shift(), sleep: () => sleeps++ });
  assert.equal(sleeps, 2);
});
test('another online instance cannot satisfy target readiness', () => {
  let sleeps = 0;
  assert.throws(() => waitForSsm({ ...base, attempts: 2, read: () => [{ InstanceId: 'i-other', PingStatus: 'Online' }], sleep: () => sleeps++ }), /SSM is not Online for i-target in ap-south-1/);
  assert.equal(sleeps, 1);
});
test('AWS access failures propagate instead of being mistaken for offline state', () => {
  assert.throws(() => waitForSsm({ ...base, read: () => { throw new Error('AccessDenied'); }, sleep: () => assert.fail('should not wait') }), /AccessDenied/);
});
