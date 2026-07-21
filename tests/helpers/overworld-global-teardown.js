const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.OVERWORLD_TEST_PORT ?? '5184', 10);

export default async function overworldGlobalTeardown() {
  const url = `http://${HOST}:${PORT}/__overworld_test_shutdown__`;
  try {
    await fetch(url, { method: 'POST', cache: 'no-store' });
  } catch {
    // A server that already exited needs no teardown.
  }

  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://${HOST}:${PORT}/`, { cache: 'no-store' });
      await new Promise((resolve) => setTimeout(resolve, 50));
    } catch {
      return;
    }
  }
  throw new Error(`Isolated overworld test server did not close on port ${PORT}.`);
}
