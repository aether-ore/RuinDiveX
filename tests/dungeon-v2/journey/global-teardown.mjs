import { request } from 'node:http';
import { connect } from 'node:net';

const SHUTDOWN_PATH = '/__dungeon-v2-test-shutdown';
const SHUTDOWN_TIMEOUT_MS = 5_000;

function requestOwnedServerShutdown(port, token) {
  return new Promise((resolve, reject) => {
    const shutdownRequest = request({
      host: '127.0.0.1',
      port,
      path: SHUTDOWN_PATH,
      method: 'POST',
      headers: {
        'X-Dungeon-V2-Shutdown-Token': token,
        Connection: 'close',
      },
    }, (response) => {
      response.resume();
      response.once('end', () => {
        if (response.statusCode === 202) resolve();
        else reject(new Error(`Dungeon V2 test server rejected owned shutdown with HTTP ${response.statusCode}.`));
      });
    });
    shutdownRequest.setTimeout(SHUTDOWN_TIMEOUT_MS, () => {
      shutdownRequest.destroy(new Error('Dungeon V2 test server shutdown request timed out.'));
    });
    shutdownRequest.once('error', reject);
    shutdownRequest.end();
  });
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(250);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitForPortToClose(port) {
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!await isPortListening(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Dungeon V2 test server still owns port ${port} after shutdown.`);
}

export default async function shutdownDungeonV2JourneyServer(config) {
  const port = Number(config.metadata?.dungeonV2ServerPort);
  const token = String(config.metadata?.dungeonV2ServerShutdownToken ?? '');
  if (!Number.isInteger(port) || port <= 0 || port > 65_535 || !token) {
    throw new Error('Dungeon V2 journey server teardown is missing its owned port/token contract.');
  }

  try {
    await requestOwnedServerShutdown(port, token);
  } catch (error) {
    if (error?.code !== 'ECONNREFUSED') throw error;
    // A server which already exited owns no process that this teardown may
    // kill. Treat that as complete while preserving the original test result.
  }
  await waitForPortToClose(port);
}
