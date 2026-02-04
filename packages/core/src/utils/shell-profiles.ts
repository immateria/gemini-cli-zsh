/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import type { ShellType, ShellConfiguration } from './shell-utils.js';

/**
 * Unique identifier for a shell profile.
 */
export type ShellProfileId =
  | 'bash'
  | 'zsh'
  | 'fish'
  | 'nushell'
  | 'elvish'
  | 'powershell'
  | 'cmd';

/**
 * Shell capabilities that affect how commands are generated and executed.
 */
export interface ShellCapabilities {
  /** Whether the shell supports background jobs with & */
  supportsBackgroundJobs: boolean;
  /** Whether the shell outputs structured data (objects, not text) */
  supportsStructuredOutput: boolean;
  /** Whether the shell is POSIX-compatible */
  posixCompatible: boolean;
  /** Whether && and || work for command chaining */
  supportsAndOr: boolean;
  /** Whether the shell supports job control (fg, bg, jobs) */
  supportsJobControl: boolean;
}

/**
 * Complete definition of a shell profile - everything needed to configure
 * and guide the AI for a specific shell.
 */
export interface ShellProfileDefinition {
  /** Unique identifier */
  id: ShellProfileId;
  /** Human-readable name */
  displayName: string;
  /** The shell type for parsing/escaping logic */
  shellType: ShellType;

  // Execution configuration
  /** Default executable name or path */
  executable: string;
  /** Arguments passed before the command (e.g., ['-c']) */
  argsPrefix: string[];

  // AI guidance
  /** Concise guidance for the AI about this shell's syntax */
  guidance: string;
  /** Common syntax patterns with examples */
  syntaxExamples: {
    /** How to set a variable */
    setVariable?: string;
    /** How to export a variable */
    exportVariable?: string;
    /** How to run a command in background */
    backgroundJob?: string;
    /** How to chain commands on success */
    chainOnSuccess?: string;
    /** How to chain commands on failure */
    chainOnFailure?: string;
    /** How to do command substitution */
    commandSubstitution?: string;
    /** How to define a function */
    defineFunction?: string;
    /** How to iterate over items */
    forLoop?: string;
    /** Additional shell-specific examples */
    [key: string]: string | undefined;
  };

  // Tool mappings - maps common Unix tools to shell-native alternatives
  toolReplacements: Record<string, string>;
  /** Preferred search command for this shell */
  searchCommand: string;
  /** Optional guidance about how search works in this shell */
  searchGuidance?: string;

  // Capabilities
  capabilities: ShellCapabilities;
}

/**
 * Complete registry of all supported shell profiles.
 */
export const SHELL_PROFILE_REGISTRY: Record<
  ShellProfileId,
  ShellProfileDefinition
> = {
  bash: {
    id: 'bash',
    displayName: 'Bash',
    shellType: 'bash',
    executable: 'bash',
    argsPrefix: ['-c'],
    guidance:
      'Use bash-compatible syntax. Arrays are 0-indexed. Use `[[` for conditionals.',
    syntaxExamples: {
      setVariable: 'VAR=value',
      exportVariable: 'export VAR=value',
      backgroundJob: 'cmd &',
      chainOnSuccess: 'cmd1 && cmd2',
      chainOnFailure: 'cmd1 || cmd2',
      commandSubstitution: '$(cmd) or `cmd`',
      defineFunction: 'func() { ...; }',
      forLoop: 'for i in a b c; do echo $i; done',
      array: 'arr=(a b c); echo ${arr[0]}',
      conditional: '[[ -f file ]] && echo exists',
    },
    toolReplacements: {
      grep: 'rg (ripgrep)',
      find: 'fd',
      sed: 'sd',
      cat: 'bat',
    },
    searchCommand: 'rg',
    capabilities: {
      supportsBackgroundJobs: true,
      supportsStructuredOutput: false,
      posixCompatible: true,
      supportsAndOr: true,
      supportsJobControl: true,
    },
  },

  zsh: {
    id: 'zsh',
    displayName: 'Zsh',
    shellType: 'zsh',
    executable: 'zsh',
    argsPrefix: ['-c'],
    guidance:
      'Use zsh syntax. Arrays are 1-indexed. Use glob qualifiers. Avoid bash-only builtins.',
    syntaxExamples: {
      setVariable: 'VAR=value',
      exportVariable: 'export VAR=value',
      backgroundJob: 'cmd &',
      chainOnSuccess: 'cmd1 && cmd2',
      chainOnFailure: 'cmd1 || cmd2',
      commandSubstitution: '$(cmd)',
      defineFunction: 'func() { ...; }',
      forLoop: 'for i in a b c; do echo $i; done',
      array: 'arr=(a b c); echo $arr[1]  # 1-indexed!',
      globQualifier: '*(.)  # files only, *(/) dirs only',
      extendedGlob: '**/*.ts  # recursive glob',
    },
    toolReplacements: {
      grep: 'rg (ripgrep)',
      find: 'fd',
      sed: 'sd',
      cat: 'bat',
    },
    searchCommand: 'rg',
    capabilities: {
      supportsBackgroundJobs: true,
      supportsStructuredOutput: false,
      posixCompatible: true,
      supportsAndOr: true,
      supportsJobControl: true,
    },
  },

  fish: {
    id: 'fish',
    displayName: 'Fish',
    shellType: 'fish',
    executable: 'fish',
    argsPrefix: ['-c'],
    guidance:
      'Use fish syntax. No POSIX compatibility. Use `set` for variables, `(cmd)` for substitution.',
    syntaxExamples: {
      setVariable: 'set VAR value',
      exportVariable: 'set -x VAR value',
      backgroundJob: 'cmd &',
      chainOnSuccess: 'cmd1; and cmd2  # or && in fish 3.0+',
      chainOnFailure: 'cmd1; or cmd2   # or || in fish 3.0+',
      commandSubstitution: '(cmd)  # NOT $(cmd)',
      defineFunction: 'function name; ...; end',
      forLoop: 'for i in a b c; echo $i; end',
      conditional: 'if test -f file; echo exists; end',
      list: 'set mylist a b c; echo $mylist[1]',
    },
    toolReplacements: {
      grep: 'rg (ripgrep)',
      find: 'fd',
      sed: 'string replace (builtin) or sd',
      cat: 'bat',
      export: 'set -x',
    },
    searchCommand: 'rg',
    capabilities: {
      supportsBackgroundJobs: true,
      supportsStructuredOutput: false,
      posixCompatible: false,
      supportsAndOr: true, // fish 3.0+
      supportsJobControl: true,
    },
  },

  nushell: {
    id: 'nushell',
    displayName: 'Nushell',
    shellType: 'other',
    executable: 'nu',
    argsPrefix: ['-c'],
    guidance:
      'Use nushell syntax. Pipelines pass structured data. No && or ||. Use `where`, `select`, `get`.',
    syntaxExamples: {
      setVariable: 'let var = value  # immutable',
      mutableVariable: 'mut var = value  # mutable',
      exportVariable: '$env.VAR = value',
      backgroundJob: 'N/A - use `job spawn { cmd }`',
      chainOnSuccess: 'cmd1; cmd2  # or use try { }',
      chainOnFailure: 'try { cmd1 } catch { cmd2 }',
      commandSubstitution: '(cmd)',
      defineFunction: 'def name [] { ... }',
      forLoop: 'for i in [a b c] { echo $i }',
      list: '[a b c]',
      record: '{name: value, key: val}',
      pipeline: 'ls | where size > 1mb | select name',
      jsonParse: 'open file.json | get path.to.value',
    },
    toolReplacements: {
      grep: 'rg, or: lines | where {|l| $l =~ pattern}',
      find: 'fd, or: ls **/* | where name =~ pattern',
      sed: 'str replace',
      awk: 'select, get, split column',
      cat: 'open (returns structured data)',
      jq: 'native: open file.json | get path',
      curl: 'http get',
    },
    searchCommand: 'rg',
    searchGuidance:
      'For structured filtering, use `| where` on pipeline output.',
    capabilities: {
      supportsBackgroundJobs: false, // job spawn is different
      supportsStructuredOutput: true,
      posixCompatible: false,
      supportsAndOr: false,
      supportsJobControl: false,
    },
  },

  elvish: {
    id: 'elvish',
    displayName: 'Elvish',
    shellType: 'other',
    executable: 'elvish',
    argsPrefix: ['-c'],
    guidance:
      'Use elvish syntax. Pipelines pass values. Use `e:` prefix for external commands.',
    syntaxExamples: {
      setVariable: 'set var = value',
      exportVariable: 'set-env VAR value',
      backgroundJob: 'cmd &',
      chainOnSuccess: 'try { cmd1 } else { }; cmd2',
      chainOnFailure: 'try { cmd1 } catch { cmd2 }',
      commandSubstitution: '(cmd)',
      defineFunction: 'fn name { ... }',
      forLoop: 'for i [a b c] { echo $i }',
      list: '[a b c]',
      map: '[&key=value &k2=v2]',
      externalCommand: 'e:grep pattern file',
      pipeline: 'ls | each {|f| echo $f }',
    },
    toolReplacements: {
      grep: 'rg or e:grep',
      find: 'fd or e:find',
      sed: 'e:sed or sd',
      cat: 'e:cat or bat',
    },
    searchCommand: 'rg',
    capabilities: {
      supportsBackgroundJobs: true,
      supportsStructuredOutput: true,
      posixCompatible: false,
      supportsAndOr: false,
      supportsJobControl: true,
    },
  },

  powershell: {
    id: 'powershell',
    displayName: 'PowerShell',
    shellType: 'powershell',
    executable: 'pwsh',
    argsPrefix: ['-NoProfile', '-Command'],
    guidance:
      'Use PowerShell cmdlets. Pipelines pass objects. Use `$_` in script blocks.',
    syntaxExamples: {
      setVariable: '$var = value',
      exportVariable: '$env:VAR = value',
      backgroundJob: 'Start-Job { cmd } or cmd &',
      chainOnSuccess: 'cmd1 && cmd2  # PS 7+',
      chainOnFailure: 'cmd1 || cmd2  # PS 7+',
      commandSubstitution: '$(cmd)',
      defineFunction: 'function Name { param(...) ... }',
      forLoop: 'foreach ($i in @("a","b","c")) { Write-Host $i }',
      array: '@(1, 2, 3)',
      hashtable: '@{key="value"; k2="v2"}',
      pipeline: 'Get-ChildItem | Where-Object { $_.Length -gt 1MB }',
      filterAlias: 'gci | ? { $_.Name -like "*.ts" }',
    },
    toolReplacements: {
      grep: 'Select-String or sls',
      find: 'Get-ChildItem -Recurse or gci -r',
      cat: 'Get-Content or gc',
      curl: 'Invoke-WebRequest or iwr',
      wget: 'Invoke-WebRequest -OutFile',
      ls: 'Get-ChildItem or gci',
      rm: 'Remove-Item or ri',
      cp: 'Copy-Item or copy',
      mv: 'Move-Item or move',
      echo: 'Write-Host or Write-Output',
    },
    searchCommand: 'Select-String',
    searchGuidance: 'Use Select-String for text search, Where-Object for filtering objects.',
    capabilities: {
      supportsBackgroundJobs: true,
      supportsStructuredOutput: true,
      posixCompatible: false,
      supportsAndOr: true, // PS 7+
      supportsJobControl: true,
    },
  },

  cmd: {
    id: 'cmd',
    displayName: 'Windows CMD',
    shellType: 'cmd',
    executable: 'cmd.exe',
    argsPrefix: ['/c'],
    guidance:
      'Use Windows cmd.exe syntax. Variables use %VAR% or !VAR! with delayed expansion.',
    syntaxExamples: {
      setVariable: 'set VAR=value',
      exportVariable: 'set VAR=value  # same as set',
      backgroundJob: 'start /b cmd',
      chainOnSuccess: 'cmd1 && cmd2',
      chainOnFailure: 'cmd1 || cmd2',
      commandSubstitution: 'for /f "tokens=*" %i in (\'cmd\') do @echo %i',
      forLoop: 'for %i in (a b c) do @echo %i',
      conditional: 'if exist file echo exists',
      redirect: '> file 2>&1',
      delayedExpansion: 'setlocal enabledelayedexpansion & set VAR=x & echo !VAR!',
    },
    toolReplacements: {
      grep: 'findstr',
      find: 'dir /s /b',
      cat: 'type',
      ls: 'dir',
      rm: 'del',
      cp: 'copy',
      mv: 'move',
      pwd: 'cd',
      clear: 'cls',
    },
    searchCommand: 'findstr',
    searchGuidance: 'Use findstr /s /i for recursive case-insensitive search.',
    capabilities: {
      supportsBackgroundJobs: true, // start /b
      supportsStructuredOutput: false,
      posixCompatible: false,
      supportsAndOr: true,
      supportsJobControl: false,
    },
  },
};

/**
 * Gets a shell profile by ID.
 */
export function getShellProfile(id: ShellProfileId): ShellProfileDefinition {
  return SHELL_PROFILE_REGISTRY[id];
}

/**
 * Gets all available shell profile IDs.
 */
export function getAllShellProfileIds(): readonly ShellProfileId[] {
  return Object.keys(SHELL_PROFILE_REGISTRY) as ShellProfileId[];
}

/**
 * Gets the shell configuration (for execution) from a profile.
 */
export function getShellConfigurationFromProfile(
  id: ShellProfileId,
): Partial<ShellConfiguration> {
  const profile = SHELL_PROFILE_REGISTRY[id];
  return {
    executable: profile.executable,
    argsPrefix: profile.argsPrefix,
    shell: profile.shellType,
  };
}

/**
 * Builds a comprehensive guidance string from a profile for the AI.
 */
export function buildProfileGuidance(id: ShellProfileId): string {
  const profile = SHELL_PROFILE_REGISTRY[id];
  const parts: string[] = [profile.guidance];

  // Add capability-based hints
  if (!profile.capabilities.supportsAndOr) {
    parts.push('Do NOT use && or || for chaining commands.');
  }
  if (!profile.capabilities.supportsBackgroundJobs) {
    parts.push('Background jobs via & are not supported.');
  }
  if (profile.capabilities.supportsStructuredOutput) {
    parts.push('Pipelines pass structured data (objects), not plain text.');
  }

  return parts.join(' ');
}

/**
 * Detects a shell profile from the $SHELL environment variable.
 */
export function detectShellProfileFromEnv(): ShellProfileId | undefined {
  const shellEnv = process.env['SHELL'];
  if (!shellEnv) {
    return undefined;
  }

  const basename = path.basename(shellEnv).toLowerCase();

  const executableToProfile: Record<string, ShellProfileId> = {
    bash: 'bash',
    zsh: 'zsh',
    fish: 'fish',
    nu: 'nushell',
    nushell: 'nushell',
    elvish: 'elvish',
    pwsh: 'powershell',
    powershell: 'powershell',
  };

  return executableToProfile[basename];
}

/**
 * Formats tool replacements for display to the AI.
 * Returns a string like: "grep→rg, sed→sd, cat→bat"
 */
export function formatToolReplacements(
  replacements: Record<string, string>,
): string {
  return Object.entries(replacements)
    .map(([tool, replacement]) => `${tool}→${replacement}`)
    .join(', ');
}
