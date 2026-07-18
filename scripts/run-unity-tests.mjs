import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const DEFAULT_PROJECT = path.join(REPOSITORY_ROOT, 'unity', 'RuinCrawler');

const HELP = `Run Ruin Crawler's Unity Test Framework suites in a headless Editor.

Usage:
  node scripts/run-unity-tests.mjs --mode <EditMode|PlayMode> [options]

Options:
  --mode <mode>       Required test platform: EditMode or PlayMode.
  --project <path>    Unity project path (default: unity/RuinCrawler).
  --editor <path>     Unity Editor executable. Overrides discovery and
                      UNITY_EDITOR_PATH.
  --results <path>    NUnit XML output path (default:
                      artifacts/unity-tests/<mode>.xml).
  --print-command     Print the resolved command without starting Unity.
  --help, -h          Show this help.

Editor discovery order:
  1. --editor
  2. UNITY_EDITOR_PATH
  3. The project version under conventional Unity Hub locations

Examples:
  npm run test:unity:edit
  npm run test:unity:play -- --results artifacts/unity-tests/play-ci.xml
  npm run test:unity:edit -- --print-command
`;

function fail(message, exitCode = 1) {
  console.error(`[unity-tests] ${message}`);
  process.exitCode = exitCode;
}

function readOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parseArguments(argv) {
  const options = {
    mode: null,
    project: DEFAULT_PROJECT,
    editor: null,
    results: null,
    printCommand: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--print-command') {
      options.printCommand = true;
      continue;
    }

    const equalsIndex = argument.indexOf('=');
    const option = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
    const inlineValue = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : null;
    if (!['--mode', '--project', '--editor', '--results'].includes(option)) {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const value = inlineValue ?? readOptionValue(argv, index, option);
    if (inlineValue === null) {
      index += 1;
    }
    if (!value) {
      throw new Error(`${option} requires a value.`);
    }

    if (option === '--mode') options.mode = value;
    if (option === '--project') options.project = value;
    if (option === '--editor') options.editor = value;
    if (option === '--results') options.results = value;
  }

  return options;
}

function normalizeMode(value) {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'edit' || normalized === 'editmode') return 'EditMode';
  if (normalized === 'play' || normalized === 'playmode') return 'PlayMode';
  throw new Error('--mode must be EditMode or PlayMode.');
}

function readProjectVersion(projectPath) {
  const versionFile = path.join(projectPath, 'ProjectSettings', 'ProjectVersion.txt');
  if (!existsSync(versionFile)) {
    throw new Error(
      `Unity project version file was not found: ${versionFile}\n` +
      'Pass --project with the directory that contains Assets and ProjectSettings.',
    );
  }

  const contents = readFileSync(versionFile, 'utf8');
  const match = /^m_EditorVersion:\s*(\S+)\s*$/m.exec(contents);
  if (!match) {
    throw new Error(`Could not read m_EditorVersion from ${versionFile}.`);
  }
  return match[1];
}

function conventionalEditorCandidates(version) {
  if (process.platform === 'win32') {
    const roots = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
    ].filter(Boolean);

    const candidates = [];
    for (const root of roots) {
      candidates.push(path.join(root, 'Unity', 'Hub', 'Editor', version, 'Editor', 'Unity.exe'));
      candidates.push(path.join(root, 'Unity Hub', 'Editor', version, 'Editor', 'Unity.exe'));
    }
    candidates.push(path.join('C:\\Program Files', 'Unity', 'Hub', 'Editor', version, 'Editor', 'Unity.exe'));
    return candidates;
  }

  if (process.platform === 'darwin') {
    return [
      `/Applications/Unity/Hub/Editor/${version}/Unity.app/Contents/MacOS/Unity`,
      `${homedir()}/Applications/Unity/Hub/Editor/${version}/Unity.app/Contents/MacOS/Unity`,
    ];
  }

  return [
    path.join(homedir(), 'Unity', 'Hub', 'Editor', version, 'Editor', 'Unity'),
    path.join('/opt', 'unity', 'hub', 'editor', version, 'Editor', 'Unity'),
    path.join('/opt', 'Unity', 'Hub', 'Editor', version, 'Editor', 'Unity'),
  ];
}

function uniquePaths(paths) {
  const seen = new Set();
  return paths.filter((candidate) => {
    const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveEditor(explicitEditor, version) {
  const configured = explicitEditor || process.env.UNITY_EDITOR_PATH;
  if (configured) {
    const resolved = path.resolve(configured);
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      const source = explicitEditor ? '--editor' : 'UNITY_EDITOR_PATH';
      throw new Error(`${source} does not point to a Unity Editor executable: ${resolved}`);
    }
    return { editor: resolved, searched: [resolved] };
  }

  const searched = uniquePaths(conventionalEditorCandidates(version));
  const editor = searched.find((candidate) => {
    try {
      return existsSync(candidate) && statSync(candidate).isFile();
    } catch {
      return false;
    }
  });

  if (!editor) {
    throw new Error(
      `Unity Editor ${version} was not found.\n` +
      `Searched:\n${searched.map((candidate) => `  - ${candidate}`).join('\n')}\n` +
      'Install that project version in Unity Hub, pass --editor, or set UNITY_EDITOR_PATH.',
    );
  }
  return { editor, searched };
}

function quoteForDisplay(value) {
  if (process.platform === 'win32') {
    if (!/[\s"]/u.test(value)) return value;
    return `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1')}"`;
  }
  if (/^[A-Za-z0-9_./:=+-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function validateResultFile(resultsPath, startedAt) {
  if (!existsSync(resultsPath)) {
    throw new Error(
      `Unity exited successfully but did not create the test result file: ${resultsPath}\n` +
      'Inspect the Unity log above for compilation, licensing, or Test Framework errors.',
    );
  }

  const resultStats = statSync(resultsPath);
  if (!resultStats.isFile() || resultStats.size === 0) {
    throw new Error(`Unity test result is not a non-empty file: ${resultsPath}`);
  }
  if (resultStats.mtimeMs + 2000 < startedAt) {
    throw new Error(`Unity did not refresh the existing test result file: ${resultsPath}`);
  }

  const contents = readFileSync(resultsPath, 'utf8');
  if (!/<test-run(?:\s|>)/u.test(contents)) {
    throw new Error(`Unity test result is not NUnit test-run XML: ${resultsPath}`);
  }
}

function run(editor, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(editor, arguments_, { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    fail(`${error.message}\nRun with --help for usage.`);
    return;
  }

  if (options.help) {
    console.log(HELP);
    return;
  }

  try {
    const mode = normalizeMode(options.mode);
    const projectPath = path.resolve(options.project);
    if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
      throw new Error(`Unity project directory was not found: ${projectPath}`);
    }

    const version = readProjectVersion(projectPath);
    const { editor } = resolveEditor(options.editor, version);
    const resultsPath = path.resolve(
      options.results ?? path.join(REPOSITORY_ROOT, 'artifacts', 'unity-tests', `${mode}.xml`),
    );
    if (existsSync(resultsPath) && statSync(resultsPath).isDirectory()) {
      throw new Error(`--results must name an XML file, not a directory: ${resultsPath}`);
    }

    const unityArguments = [
      '-batchmode',
      '-nographics',
      '-projectPath', projectPath,
      '-runTests',
      '-testPlatform', mode,
      '-testResults', resultsPath,
      '-logFile', '-',
      '-quit',
    ];
    const command = [editor, ...unityArguments].map(quoteForDisplay).join(' ');

    if (options.printCommand) {
      console.log(command);
      return;
    }

    mkdirSync(path.dirname(resultsPath), { recursive: true });
    console.log(`[unity-tests] Editor: ${editor}`);
    console.log(`[unity-tests] Project: ${projectPath}`);
    console.log(`[unity-tests] Version: ${version}`);
    console.log(`[unity-tests] Platform: ${mode}`);
    console.log(`[unity-tests] Results: ${resultsPath}`);

    const startedAt = Date.now();
    let outcome;
    try {
      outcome = await run(editor, unityArguments);
    } catch (error) {
      throw new Error(`Could not start Unity Editor at ${editor}: ${error.message}`);
    }

    if (outcome.signal) {
      fail(`Unity was terminated by signal ${outcome.signal}.`, 1);
      return;
    }
    if (outcome.code !== 0) {
      fail(
        `Unity exited with code ${outcome.code}. Test results may be available at ${resultsPath}.`,
        outcome.code ?? 1,
      );
      return;
    }

    validateResultFile(resultsPath, startedAt);
    console.log(`[unity-tests] ${mode} completed successfully: ${resultsPath}`);
  } catch (error) {
    fail(error.message);
  }
}

await main();
