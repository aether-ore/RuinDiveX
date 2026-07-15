import {
  runBusterBalanceSearch,
  summarizeBusterBalanceResult,
} from '../src/buster/BusterBalanceGate.js';

const result = runBusterBalanceSearch();
const summary = summarizeBusterBalanceResult(result);

console.log(`Custom Buster v0.2 frozen-catalog verdict: ${result.releaseReady ? 'PASS' : 'BLOCKED'}`);
console.log(`Production constants: ${JSON.stringify(summary.constants)}`);

for (const [heading, section] of Object.entries(summary.sections)) {
  console.log(`\n${heading}`);
  console.log(JSON.stringify(section, null, 2));
}

if (!result.releaseReady) {
  const hardFailures = result.hardCorrectness.failures.length;
  const roleFailures = result.roleContracts.failures.length;
  console.error(
    `\nRelease blocked by ${hardFailures} hard correctness failure(s) `
      + `and ${roleFailures} frozen-catalog role failure(s).`,
  );
  process.exitCode = 1;
}

