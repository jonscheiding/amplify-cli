import * as path from 'path';
import * as execa from 'execa';
import * as fs from 'fs-extra';
import { executeHooks, HooksMeta, skipHooksFilePath } from '../../hooks';
import * as skipHooksModule from '../../hooks/skipHooks';
import { pathManager, stateManager } from '../../state-manager';
import { CommandLineInput } from '../../types';

const pathToPython3Runtime = 'path/to/python3/runtime';
const pathToPythonRuntime = 'path/to/python/runtime';
const pathToNodeRuntime = 'path/to/node/runtime';
const preStatusNodeFileName = 'pre-status.js';
const preStatusPythonFileName = 'pre-status.py';
const preAddFileName = 'pre-add.js';
const preAddAuthFileName = 'pre-add-auth.js';
const postAddFileName = 'post-add.js';
const postAddAuthFileName = 'post-add-auth.js';
const testProjectRootPath = 'testProjectRootPath';
const testProjectHooksDirPath = 'testProjectHooksDirPath';

const testProjectHooksFiles = [
  preStatusNodeFileName,
  preStatusPythonFileName,
  preAddFileName,
  preAddAuthFileName,
  postAddFileName,
  postAddAuthFileName,
  'pre-pull.py',
  'pre-push.py',
];

const stateManagerMock = stateManager as jest.Mocked<typeof stateManager>;
const pathManagerMock = pathManager as jest.Mocked<typeof pathManager>;

pathManagerMock.findProjectRoot.mockReturnValue(testProjectRootPath);
pathManagerMock.getHooksDirPath.mockReturnValue(testProjectHooksDirPath);
stateManagerMock.getHooksConfigJson.mockReturnValueOnce({ extensions: { py: { runtime: 'python3' } } });

jest.mock('execa');
jest.mock('../../state-manager');
jest.mock('which', () => ({
  sync: jest.fn().mockImplementation((runtimeName) => {
    if (runtimeName === 'python3') return pathToPython3Runtime;
    if (runtimeName === 'python') return pathToPythonRuntime;
    if (runtimeName === 'node') return pathToNodeRuntime;
  }),
}));
jest.mock('fs-extra', () => {
  const actualFs = jest.requireActual('fs-extra');
  return {
    ...{ ...actualFs },
    readdirSync: jest.fn().mockImplementation((path, options) => {
      if (path === testProjectHooksDirPath) {
        return testProjectHooksFiles;
      }
      return actualFs.readdirSync(path, options);
    }),
    lstatSync: jest.fn().mockImplementation((pathStr) => {
      if (testProjectHooksFiles.includes(path.relative(testProjectHooksDirPath, pathStr))) {
        return { isFile: jest.fn().mockReturnValue(true) };
      }
      return actualFs.lstatSync(pathStr);
    }),
    existsSync: jest.fn().mockImplementation((path) => {
      if (path === testProjectHooksDirPath) return true;
      return actualFs.existsSync(path);
    }),
  };
});
jest.mock('../../hooks/hooksConstants', () => {
  const orgConstants = jest.requireActual('../../hooks/hooksConstants');
  return { ...{ ...orgConstants }, skipHooksFilePath: path.join(__dirname, '..', 'testFiles', 'skiphooktestfile') };
});

let mockSkipHooks = jest.spyOn(skipHooksModule, 'skipHooks');

describe('hooksExecutioner tests', () => {
  beforeEach(async () => {
    HooksMeta.getInstance();
    jest.clearAllMocks();
  });
  afterEach(() => {
    HooksMeta.releaseInstance();
  });

  test('skip Hooks test', async () => {
    mockSkipHooks.mockRestore();

    const orgSkipHooksExist = fs.existsSync(skipHooksFilePath);

    fs.ensureFileSync(skipHooksFilePath);
    // skip hooks file exists so no execa calls should be made
    await executeHooks(HooksMeta.getInstance({ command: 'push', plugin: 'core' } as CommandLineInput, 'pre'));
    expect(execa).toHaveBeenCalledTimes(0);

    fs.removeSync(skipHooksFilePath);
    // skip hooks file does not exists so execa calls should be made
    await executeHooks(HooksMeta.getInstance({ command: 'push', plugin: 'core' } as CommandLineInput, 'pre'));
    expect(execa).not.toHaveBeenCalledTimes(0);

    // restoring the original state of skip hooks file
    if (!orgSkipHooksExist) fs.removeSync(skipHooksFilePath);
    else fs.ensureFileSync(skipHooksFilePath);
    mockSkipHooks = jest.spyOn(skipHooksModule, 'skipHooks');
  });

  test('executeHooks with no context', async () => {
    await executeHooks(HooksMeta.getInstance());
    expect(execa).toHaveBeenCalledTimes(0);
    const hooksMeta = HooksMeta.getInstance();
    hooksMeta.setEventCommand('add');
    await executeHooks(HooksMeta.getInstance(undefined, 'pre'));
    expect(execa).toHaveBeenCalledTimes(1);
  });

  test('should not call execa for unrecognised events', async () => {
    await executeHooks(HooksMeta.getInstance({ command: 'init', plugin: 'core' } as CommandLineInput, 'pre'));
    expect(execa).toHaveBeenCalledTimes(0);
  });

  test('should execute in specificity execution order', async () => {
    await executeHooks(HooksMeta.getInstance({ command: 'add', plugin: 'auth' } as CommandLineInput, 'pre'));
    expect(execa).toHaveBeenNthCalledWith(1, pathToNodeRuntime, [path.join(testProjectHooksDirPath, preAddFileName)], expect.anything());
    expect(execa).toHaveBeenNthCalledWith(
      2,
      pathToNodeRuntime,
      [path.join(testProjectHooksDirPath, preAddAuthFileName)],
      expect.anything(),
    );

    await executeHooks(HooksMeta.getInstance({ command: 'add', plugin: 'auth' } as CommandLineInput, 'post'));
    expect(execa).toHaveBeenNthCalledWith(3, pathToNodeRuntime, [path.join(testProjectHooksDirPath, postAddFileName)], expect.anything());
    expect(execa).toHaveBeenNthCalledWith(
      4,
      pathToNodeRuntime,
      [path.join(testProjectHooksDirPath, postAddAuthFileName)],
      expect.anything(),
    );
  });

  test('should determine runtime from hooks-config', async () => {
    stateManagerMock.getHooksConfigJson.mockReturnValueOnce({ extensions: { py: { runtime: 'python3' } } });
    await executeHooks(HooksMeta.getInstance({ command: 'pull', plugin: 'core' } as CommandLineInput, 'pre'));
    expect(execa).toHaveBeenCalledWith(pathToPython3Runtime, ['testProjectHooksDirPath/pre-pull.py'], expect.anything());
  });

  test('should determine runtime options from hooks-config', async () => {
    stateManagerMock.getHooksConfigJson.mockReturnValueOnce({
      extensions: { py: { runtime: 'python3', runtime_options: ['mock1', 'mock2'] } },
    });
    await executeHooks(HooksMeta.getInstance({ command: 'pull', plugin: 'core' } as CommandLineInput, 'pre'));
    expect(execa).toHaveBeenCalledWith(pathToPython3Runtime, ['mock1', 'mock2', 'testProjectHooksDirPath/pre-pull.py'], expect.anything());
  });

  test('should determine empty array runtime options from hooks-config', async () => {
    stateManagerMock.getHooksConfigJson.mockClear();
    stateManagerMock.getHooksConfigJson.mockReturnValueOnce({ extensions: { py: { runtime: 'python3', runtime_options: [] } } });
    await executeHooks(HooksMeta.getInstance({ command: 'pull', plugin: 'core' } as CommandLineInput, 'pre'));
    expect(execa).toHaveBeenCalledWith(pathToPython3Runtime, ['testProjectHooksDirPath/pre-pull.py'], expect.anything());
  });

  test('should determine windows runtime from hooks-config', async () => {
    stateManagerMock.getHooksConfigJson.mockReturnValueOnce({
      extensions: { py: { runtime: 'python3', runtime_windows: 'python' } },
    });
    Object.defineProperty(process, 'platform', { value: 'win32' });
    await executeHooks(HooksMeta.getInstance({ command: 'pull', plugin: 'core' } as CommandLineInput, 'pre'));
    expect(execa).toHaveBeenCalledWith(pathToPythonRuntime, expect.anything(), expect.anything());
  });

  test('should not run the script for undefined extension/runtime', async () => {
    await executeHooks(HooksMeta.getInstance({ command: 'pull', plugin: 'core' } as CommandLineInput, 'pre'));
    expect(execa).toBeCalledTimes(0);
  });

  test('should throw error if duplicate hook scripts are present', async () => {
    const duplicateErrorThrown = `found duplicate hook scripts: ${preStatusNodeFileName}, ${preStatusPythonFileName}`;
    stateManagerMock.getHooksConfigJson.mockReturnValueOnce({
      extensions: { py: { runtime: 'python3' } },
    });
    await expect(executeHooks(HooksMeta.getInstance({ command: 'status', plugin: 'core' } as CommandLineInput, 'pre'))).rejects.toThrow(
      duplicateErrorThrown,
    );
  });
});
