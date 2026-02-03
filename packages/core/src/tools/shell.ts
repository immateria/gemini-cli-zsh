/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os, { EOL } from 'node:os';
import crypto from 'node:crypto';
import type { Config } from '../config/config.js';
import { debugLogger } from '../index.js';
import { ToolErrorType } from './tool-error.js';
import type {
  ToolInvocation,
  ToolResult,
  ToolCallConfirmationDetails,
  ToolExecuteConfirmationDetails,
} from './tools.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  ToolConfirmationOutcome,
  Kind,
  type PolicyUpdateOptions,
} from './tools.js';

import { getErrorMessage } from '../utils/errors.js';
import { summarizeToolOutput } from '../utils/summarizer.js';
import type {
  ShellExecutionConfig,
  ShellOutputEvent,
} from '../services/shellExecutionService.js';
import { ShellExecutionService } from '../services/shellExecutionService.js';
import { formatBytes } from '../utils/formatters.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';
import {
  getCommandRoots,
  initializeShellParsers,
  stripShellWrapper,
  parseCommandDetails,
  hasRedirection,
} from '../utils/shell-utils.js';
import { SHELL_TOOL_NAME } from './tool-names.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

export const OUTPUT_UPDATE_INTERVAL_MS = 1000;

// Delay so user does not see the output of the process before the process is moved to the background.
const BACKGROUND_DELAY_MS = 200;

export interface ShellToolParams {
  command: string;
  description?: string;
  dir_path?: string;
  is_background?: boolean;
}

export class ShellToolInvocation extends BaseToolInvocation<
  ShellToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: ShellToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    let description = `${this.params.command}`;
    // append optional [in directory]
    // note description is needed even if validation fails due to absolute path
    if (this.params.dir_path) {
      description += ` [in ${this.params.dir_path}]`;
    } else {
      description += ` [current working directory ${process.cwd()}]`;
    }
    // append optional (description), replacing any line breaks with spaces
    if (this.params.description) {
      description += ` (${this.params.description.replace(/\n/g, ' ')})`;
    }
    if (this.params.is_background) {
      description += ' [background]';
    }
    return description;
  }

  protected override getPolicyUpdateOptions(
    outcome: ToolConfirmationOutcome,
  ): PolicyUpdateOptions | undefined {
    if (
      outcome === ToolConfirmationOutcome.ProceedAlwaysAndSave ||
      outcome === ToolConfirmationOutcome.ProceedAlways
    ) {
      const command = stripShellWrapper(this.params.command);
          const rootCommands = [
      ...new Set(getCommandRoots(command, this.config.getShellConfiguration())),
    ];
      if (rootCommands.length > 0) {
        return { commandPrefix: rootCommands };
      }
      return { commandPrefix: this.params.command };
    }
    return undefined;
  }

  protected override async getConfirmationDetails(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const command = stripShellWrapper(this.params.command);

    const parsed = parseCommandDetails(command);
    let rootCommandDisplay = '';

    if (!parsed || parsed.hasError || parsed.details.length === 0) {
      // Fallback if parser fails
      const fallback = command.trim().split(/\s+/)[0];
      rootCommandDisplay = fallback || 'shell command';
      if (hasRedirection(command)) {
        rootCommandDisplay += ', redirection';


    // In non-interactive mode, we need to prevent the tool from hanging while
    // waiting for user input. If a tool is not fully allowed (e.g. via
    // --allowed-tools="ShellTool(wc)"), we should throw an error instead of
    // prompting for confirmation. This check is skipped in YOLO mode.
    if (
      !this.config.isInteractive() &&
      this.config.getApprovalMode() !== ApprovalMode.YOLO
    ) {
      if (this.isInvocationAllowlisted(command)) {
        // If it's an allowed shell command, we don't need to confirm execution.
        return false;
      }
    } else {
      rootCommandDisplay = parsed.details
        .map((detail) => detail.name)
        .join(', ');
    }

    const rootCommands = [...new Set(getCommandRoots(command))];

    // Rely entirely on PolicyEngine for interactive confirmation.
    // If we are here, it means PolicyEngine returned ASK_USER (or no message bus),
    // so we must provide confirmation details.
    const confirmationDetails: ToolExecuteConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Shell Command',
      command: this.params.command,
      rootCommand: rootCommandDisplay,
      rootCommands,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        await this.publishPolicyUpdate(outcome);
      },
    };
    return confirmationDetails;
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string | AnsiOutput) => void,
    shellExecutionConfig?: ShellExecutionConfig,
    setPidCallback?: (pid: number) => void,
  ): Promise<ToolResult> {
    const strippedCommand = stripShellWrapper(this.params.command);

    if (signal.aborted) {
      return {
        llmContent: 'Command was cancelled by user before it could start.',
        returnDisplay: 'Command cancelled by user.',
      };
    }

    const isWindows = os.platform() === 'win32';
    const tempFileName = `shell_pgrep_${crypto
      .randomBytes(6)
      .toString('hex')}.tmp`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);

    const timeoutMs = this.config.getShellToolInactivityTimeout();
    const shellType = this.config.getShellConfiguration().shell;
    const supportsPosixBackground =
      shellType === 'bash' || shellType === 'zsh' || shellType === 'posix';
    const timeoutController = new AbortController();
    let timeoutTimer: NodeJS.Timeout | undefined;

    // Handle signal combination manually to avoid TS issues or runtime missing features
    const combinedController = new AbortController();

    const onAbort = () => combinedController.abort();

    try {
      // pgrep is not available on Windows, so we can't get background PIDs
      const collectBackgroundPids = !isWindows && supportsPosixBackground;
      const commandToExecute = collectBackgroundPids
        ? (() => {
            // wrap command to append subprocess pids (via pgrep) to temporary file
            let command = strippedCommand.trim();
            if (!command.endsWith('&')) command += ';';
            return `{ ${command} }; __code=$?; pgrep -g 0 >${tempFilePath} 2>&1; exit $__code;`;
          })()
        : strippedCommand;

      const cwd = this.params.dir_path
        ? path.resolve(this.config.getTargetDir(), this.params.dir_path)
        : this.config.getTargetDir();

      const validationError = this.config.validatePathAccess(cwd);
      if (validationError) {
        return {
          llmContent: validationError,
          returnDisplay: 'Path not in workspace.',
          error: {
            message: validationError,
            type: ToolErrorType.PATH_NOT_IN_WORKSPACE,
          },
        };
      }
      let cumulativeOutput: string | AnsiOutput = '';
      let lastUpdateTime = Date.now();
      let isBinaryStream = false;

      const resetTimeout = () => {
        if (timeoutMs <= 0) {
          return;
        }
        if (timeoutTimer) clearTimeout(timeoutTimer);
        timeoutTimer = setTimeout(() => {
          timeoutController.abort();
        }, timeoutMs);
      };

      signal.addEventListener('abort', onAbort, { once: true });
      timeoutController.signal.addEventListener('abort', onAbort, {
        once: true,
      });

      // Start timeout
      resetTimeout();

      const { result: resultPromise, pid } =
        await ShellExecutionService.execute(
          commandToExecute,
          cwd,
          (event: ShellOutputEvent) => {
            resetTimeout(); // Reset timeout on any event
            if (!updateOutput) {
              return;
            }

            let shouldUpdate = false;

            switch (event.type) {
              case 'data':
                if (isBinaryStream) break;
                cumulativeOutput = event.chunk;
                shouldUpdate = true;
                break;
              case 'binary_detected':
                isBinaryStream = true;
                cumulativeOutput =
                  '[Binary output detected. Halting stream...]';
                shouldUpdate = true;
                break;
              case 'binary_progress':
                isBinaryStream = true;
                cumulativeOutput = `[Receiving binary output... ${formatBytes(
                  event.bytesReceived,
                )} received]`;
                if (Date.now() - lastUpdateTime > OUTPUT_UPDATE_INTERVAL_MS) {
                  shouldUpdate = true;
                }
                break;
              case 'exit':
                break;
              default: {
                throw new Error('An unhandled ShellOutputEvent was found.');
              }
            }

            if (shouldUpdate && !this.params.is_background) {
              updateOutput(cumulativeOutput);
              lastUpdateTime = Date.now();
            }
          },
          combinedController.signal,
          this.config.getEnableInteractiveShell(),
          {
            ...shellExecutionConfig,
            pager: 'cat',
            sanitizationConfig:
              shellExecutionConfig?.sanitizationConfig ??
              this.config.sanitizationConfig,
          },
        );

      if (pid) {
        if (setPidCallback) {
          setPidCallback(pid);
        }

        // If the model requested to run in the background, do so after a short delay.
        if (this.params.is_background) {
          setTimeout(() => {
            ShellExecutionService.background(pid);
          }, BACKGROUND_DELAY_MS);
        }
      }

      const result = await resultPromise;

      const backgroundPIDs: number[] = [];
      if (collectBackgroundPids) {
        let tempFileExists = false;
        try {
          await fsPromises.access(tempFilePath);
          tempFileExists = true;
        } catch {
          tempFileExists = false;
        }

        if (tempFileExists) {
          const pgrepContent = await fsPromises.readFile(tempFilePath, 'utf8');
          const pgrepLines = pgrepContent.split(EOL).filter(Boolean);
          for (const line of pgrepLines) {
            if (!/^\d+$/.test(line)) {
              debugLogger.error(`pgrep: ${line}`);
            }
            const pid = Number(line);
            if (pid !== result.pid) {
              backgroundPIDs.push(pid);
            }
          }
        } else {
          if (!signal.aborted && !result.backgrounded) {
            debugLogger.error('missing pgrep output');
          }
        }
      }

      let data: Record<string, unknown> | undefined;

      let llmContent = '';
      let timeoutMessage = '';
      if (result.aborted) {
        if (timeoutController.signal.aborted) {
          timeoutMessage = `Command was automatically cancelled because it exceeded the timeout of ${(
            timeoutMs / 60000
          ).toFixed(1)} minutes without output.`;
          llmContent = timeoutMessage;
        } else {
          llmContent =
            'Command was cancelled by user before it could complete.';
        }
        if (result.output.trim()) {
          llmContent += ` Below is the output before it was cancelled:\n${result.output}`;
        } else {
          llmContent += ' There was no output before it was cancelled.';
        }
      } else if (this.params.is_background || result.backgrounded) {
        llmContent = `Command moved to background (PID: ${result.pid}). Output hidden. Press Ctrl+B to view.`;
        data = {
          pid: result.pid,
          command: this.params.command,
          initialOutput: result.output,
        };
      } else {
        // Create a formatted error string for display, replacing the wrapper command
        // with the user-facing command.
        const llmContentParts = [`Output: ${result.output || '(empty)'}`];

        if (result.error) {
          const finalError = result.error.message.replaceAll(
            commandToExecute,
            this.params.command,
          );
          llmContentParts.push(`Error: ${finalError}`);
        }

        if (result.exitCode !== null && result.exitCode !== 0) {
          llmContentParts.push(`Exit Code: ${result.exitCode}`);
        }

        if (result.signal) {
          llmContentParts.push(`Signal: ${result.signal}`);
        }
        if (backgroundPIDs.length) {
          llmContentParts.push(`Background PIDs: ${backgroundPIDs.join(', ')}`);
        }
        if (result.pid) {
          llmContentParts.push(`Process Group PGID: ${result.pid}`);
        }

        llmContent = llmContentParts.join('\n');
      }

      let returnDisplayMessage = '';
      if (this.config.getDebugMode()) {
        returnDisplayMessage = llmContent;
      } else {
        if (this.params.is_background || result.backgrounded) {
          returnDisplayMessage = `Command moved to background (PID: ${result.pid}). Output hidden. Press Ctrl+B to view.`;
        } else if (result.output.trim()) {
          returnDisplayMessage = result.output;
        } else {
          if (result.aborted) {
            if (timeoutMessage) {
              returnDisplayMessage = timeoutMessage;
            } else {
              returnDisplayMessage = 'Command cancelled by user.';
            }
          } else if (result.signal) {
            returnDisplayMessage = `Command terminated by signal: ${result.signal}`;
          } else if (result.error) {
            returnDisplayMessage = `Command failed: ${getErrorMessage(
              result.error,
            )}`;
          } else if (result.exitCode !== null && result.exitCode !== 0) {
            returnDisplayMessage = `Command exited with code: ${result.exitCode}`;
          }
          // If output is empty and command succeeded (code 0, no error/signal/abort),
          // returnDisplayMessage will remain empty, which is fine.
        }
      }

      const summarizeConfig = this.config.getSummarizeToolOutputConfig();
      const executionError = result.error
        ? {
            error: {
              message: result.error.message,
              type: ToolErrorType.SHELL_EXECUTE_ERROR,
            },
          }
        : {};
      if (summarizeConfig && summarizeConfig[SHELL_TOOL_NAME]) {
        const summary = await summarizeToolOutput(
          this.config,
          { model: 'summarizer-shell' },
          llmContent,
          this.config.getGeminiClient(),
          signal,
        );
        return {
          llmContent: summary,
          returnDisplay: returnDisplayMessage,
          ...executionError,
        };
      }

      return {
        llmContent,
        returnDisplay: returnDisplayMessage,
        data,
        ...executionError,
      };
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      signal.removeEventListener('abort', onAbort);
      timeoutController.signal.removeEventListener('abort', onAbort);
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }

  private isInvocationAllowlisted(command: string): boolean {
    const allowedTools = this.config.getAllowedTools() || [];
    if (allowedTools.length === 0) {
      return false;
    }

    const invocation = { params: { command } } as unknown as AnyToolInvocation;
    return isShellInvocationAllowlisted(
      invocation,
      allowedTools,
      this.config.getShellConfiguration(),
    );
  }
}

function getShellGuidance(shell: string): string {
  switch (shell) {
    case 'powershell':
      return 'Use PowerShell syntax and cmdlets (e.g., Get-ChildItem, Select-Object).';
    case 'zsh':
      return 'Use zsh syntax (e.g., glob qualifiers, array indexing) and avoid bash-only builtins.';
    case 'posix':
      return 'Use POSIX sh-compatible syntax; avoid bash-specific features.';
    case 'other':
      return 'Use the configured shell’s native syntax; do not assume bash semantics.';
    default:
      return '';
  }
}

function getShellToolDescription(config: Config): string {
  const { executable, argsPrefix, shell } = config.getShellConfiguration();
  const invocation = [executable, ...argsPrefix, '<command>']
    .filter(Boolean)
    .join(' ');
  const shellLabel =
    shell === 'posix'
      ? 'POSIX-compatible'
      : shell === 'zsh'
        ? 'zsh'
        : shell === 'other'
          ? 'non-POSIX'
          : shell;
  const shellContext = `Configured shell: \`${executable}\` (${shellLabel}).`;
  const customGuidance = config.getShellGuidance();
  const defaultGuidance = getShellGuidance(shell);
  const guidance = customGuidance ?? defaultGuidance;
  const guidanceSuffix = guidance ? ` Guidance: ${guidance}` : '';
  const toolGuidanceEntries = Object.entries(
    config.getShellToolGuidance() ?? {},
  );
  const toolGuidanceSuffix =
    toolGuidanceEntries.length > 0
      ? ` Tools: ${toolGuidanceEntries
          .map(([tool, replacement]) => `${tool}→${replacement}`)
          .join(', ')}.`
      : '';
  const returnedInfo = `

      The following information is returned:

      Output: Combined stdout/stderr. Can be \`(empty)\` or partial on error and for any unwaited background processes.
      Exit Code: Only included if non-zero (command failed).
      Error: Only included if a process-level error occurred (e.g., spawn failure).
      Signal: Only included if process was terminated by a signal.
      Background PIDs: Only included if background processes were started.
      Process Group PGID: Only included if available.`;

  if (shell === 'powershell') {
    return `This tool executes a given shell command as \`${invocation}\`. ${shellContext} Command can start background processes using PowerShell constructs such as \`Start-Process -NoNewWindow\` or \`Start-Job\`.${guidanceSuffix}${toolGuidanceSuffix}${returnedInfo}`;
  }

  const syntaxGuidance =
    shell === 'bash'
      ? ''
      : shell === 'zsh'
        ? ' This shell is zsh; avoid bash-only constructs and prefer zsh-compatible syntax.'
        : shell === 'posix'
          ? ' This shell is POSIX-style; avoid bash-specific features when possible.'
          : ' This shell is non-POSIX; do not assume bash syntax and use the shell’s native constructs.';

  const backgroundGuidance =
    shell === 'other'
      ? ' Background process handling depends on the shell configuration.'
      : ' Command can start background processes using `&`.';

  return `This tool executes a given shell command as \`${invocation}\`. ${shellContext}${backgroundGuidance} Command is executed as a subprocess that leads its own process group. Command process group can be terminated as \`kill -- -PGID\` or signaled as \`kill -s SIGNAL -- -PGID\`.${syntaxGuidance}${guidanceSuffix}${toolGuidanceSuffix}${returnedInfo}`;
}

function getCommandDescription(config: Config): string {
  const { executable, argsPrefix } = config.getShellConfiguration();
  const invocation = [executable, ...argsPrefix, '<command>']
    .filter(Boolean)
    .join(' ');
  return `Exact command to execute as \`${invocation}\``;
}

export class ShellTool extends BaseDeclarativeTool<
  ShellToolParams,
  ToolResult
> {
  static readonly Name = SHELL_TOOL_NAME;

  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    void initializeShellParsers().catch(() => {
      // Errors are surfaced when parsing commands.
    });
    super(
      ShellTool.Name,
      'Shell',
      getShellToolDescription(config.getEnableInteractiveShell()),
      Kind.Execute,
      {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: getCommandDescription(config),
          },
          description: {
            type: 'string',
            description:
              'Brief description of the command for the user. Be specific and concise. Ideally a single sentence. Can be up to 3 sentences for clarity. No line breaks.',
          },
          dir_path: {
            type: 'string',
            description:
              '(OPTIONAL) The path of the directory to run the command in. If not provided, the project root directory is used. Must be a directory within the workspace and must already exist.',
          },
          is_background: {
            type: 'boolean',
            description:
              'Set to true if this command should be run in the background (e.g. for long-running servers or watchers). The command will be started, allowed to run for a brief moment to check for immediate errors, and then moved to the background.',
          },
        },
        required: ['command'],
      },
      messageBus,
      false, // output is not markdown
      true, // output can be updated
    );
  }

  protected override validateToolParamValues(
    params: ShellToolParams,
  ): string | null {
    if (!params.command.trim()) {
      return 'Command cannot be empty.';
    }

    const commandCheck = isCommandAllowed(params.command, this.config);
    if (!commandCheck.allowed) {
      if (!commandCheck.reason) {
        debugLogger.error(
          'Unexpected: isCommandAllowed returned false without a reason',
        );
        return `Command is not allowed: ${params.command}`;
      }
      return commandCheck.reason;
    }
    if (
      getCommandRoots(
        params.command,
        this.config.getShellConfiguration(),
      ).length === 0
    ) {
      return 'Could not identify command root to obtain permission from user.';
    }
    if (params.dir_path) {
      const resolvedPath = path.resolve(
        this.config.getTargetDir(),
        params.dir_path,
      );
      return this.config.validatePathAccess(resolvedPath);
    }
    return null;
  }

  protected createInvocation(
    params: ShellToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<ShellToolParams, ToolResult> {
    return new ShellToolInvocation(
      this.config,
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
    );
  }
}
