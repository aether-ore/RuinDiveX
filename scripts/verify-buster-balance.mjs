import {
  BusterBalanceGateError,
  summarizeBusterBalanceResult,
  verifyBusterBalanceSelection,
} from '../src/buster/BusterBalanceGate.js';

try {
  const selected = verifyBusterBalanceSelection();
  console.log(JSON.stringify({ releaseReady: true, selected: selected.constants }, null, 2));
} catch (error) {
  if (!(error instanceof BusterBalanceGateError)) throw error;
  console.error(JSON.stringify(summarizeBusterBalanceResult(error.result), null, 2));
  process.exitCode = 1;
}

