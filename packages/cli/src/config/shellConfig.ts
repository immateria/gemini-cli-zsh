/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Settings } from './settings.js';
import type { ShellConfiguration } from '@google/gemini-cli-core';

type ShellProfile =
  | 'bash'
  | 'zsh'
  | 'fish'
  | 'nushell'
  | 'elvish'
  | 'powershell'
  | 'cmd';

const PROFILE_DEFAULTS: Record<ShellProfile, Partial<ShellConfiguration>> = {
  bash: { executable: 'bash', argsPrefix: ['-c'], shell: 'bash' },
  zsh: { executable: 'zsh', argsPrefix: ['-c'], shell: 'zsh' },
  fish: { executable: 'fish', argsPrefix: ['-c'], shell: 'other' },
  nushell: { executable: 'nu', argsPrefix: ['-c'], shell: 'other' },
  elvish: { executable: 'elvish', argsPrefix: ['-c'], shell: 'other' },
  powershell: {
    executable: 'powershell.exe',
    argsPrefix: ['-NoProfile', '-Command'],
    shell: 'powershell',
  },
  cmd: { executable: 'cmd.exe', argsPrefix: ['/c'], shell: 'cmd' },
};

const PROFILE_GUIDANCE: Record<ShellProfile, string> = {
  bash: 'Use bash-compatible syntax and features.',
  zsh: 'Use zsh syntax (e.g., glob qualifiers, array indexing) and avoid bash-only builtins.',
  fish: 'Use fish syntax (no bash-style export; prefer `set -x VAR value`).',
  nushell:
    'Use nushell syntax (pipes are structured; avoid POSIX operators like `&&`/`||`).',
  elvish:
    'Use elvish syntax (pipelines and quoting differ from bash; avoid POSIX operators).',
  powershell: 'Use PowerShell cmdlets and syntax (e.g., Get-ChildItem).',
  cmd: 'Use Windows cmd.exe syntax (e.g., dir, &&, ||).',
};

const PROFILE_SEARCH_COMMAND: Record<ShellProfile, string> = {
  bash: 'rg',
  zsh: 'rg',
  fish: 'rg',
  nushell: 'rg',
  elvish: 'rg',
  powershell: 'Get-ChildItem',
  cmd: 'findstr',
};

const normalizeExecutable = (
  executable: unknown,
): string | undefined => {
  if (typeof executable !== 'string') {
    return undefined;
  }
  const trimmed = executable.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeArgsPrefix = (
  argsPrefix: unknown,
): string[] | undefined => {
  if (!Array.isArray(argsPrefix)) {
    return undefined;
  }
  const normalized = argsPrefix.filter(
    (arg): arg is string => typeof arg === 'string' && arg.length > 0,
  );
  return normalized.length > 0 ? normalized : undefined;
};

export function resolveShellConfigurationOverrideFromSettings(
  settings: Settings,
): Partial<ShellConfiguration> | undefined {
  const profile = settings.tools?.shell?.profile as ShellProfile | undefined;
  const profileDefaults = profile ? PROFILE_DEFAULTS[profile] : undefined;
  const executable =
    normalizeExecutable(settings.tools?.shell?.executable) ??
    profileDefaults?.executable;
  const argsPrefix =
    normalizeArgsPrefix(settings.tools?.shell?.argsPrefix) ??
    profileDefaults?.argsPrefix;
  const shell = settings.tools?.shell?.shellType ?? profileDefaults?.shell;

  if (!executable && !argsPrefix && !shell) {
    return undefined;
  }

  return {
    executable,
    argsPrefix,
    shell,
  };
}

export function resolveShellGuidanceFromSettings(
  settings: Settings,
): string | undefined {
  const profile = settings.tools?.shell?.profile as ShellProfile | undefined;
  const guidance = settings.tools?.shell?.guidance;
  if (!guidance || typeof guidance !== 'string') {
    return profile ? PROFILE_GUIDANCE[profile] : undefined;
  }
  const trimmed = guidance.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return profile ? PROFILE_GUIDANCE[profile] : undefined;
}

export function resolveShellSearchCommandFromSettings(
  settings: Settings,
): string | undefined {
  const profile = settings.tools?.shell?.profile as ShellProfile | undefined;
  const searchCommand = settings.tools?.shell?.searchCommand;
  if (!searchCommand || typeof searchCommand !== 'string') {
    return profile ? PROFILE_SEARCH_COMMAND[profile] : undefined;
  }
  const trimmed = searchCommand.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return profile ? PROFILE_SEARCH_COMMAND[profile] : undefined;
}

export function resolveShellSearchGuidanceFromSettings(
  settings: Settings,
): string | undefined {
  const guidance = settings.tools?.shell?.searchGuidance;
  if (!guidance || typeof guidance !== 'string') {
    return undefined;
  }
  const trimmed = guidance.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveShellToolGuidanceFromSettings(
  settings: Settings,
): Record<string, string> | undefined {
  const toolGuidance = settings.tools?.shell?.toolGuidance;
  if (!toolGuidance || typeof toolGuidance !== 'object') {
    return undefined;
  }
  const entries = Object.entries(toolGuidance).filter(
    ([key, value]) =>
      typeof key === 'string' &&
      key.trim().length > 0 &&
      typeof value === 'string' &&
      value.trim().length > 0,
  );
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    entries.map(([key, value]) => [key.trim(), value.trim()]),
  );
}
