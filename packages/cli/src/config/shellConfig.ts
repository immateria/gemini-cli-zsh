/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Settings } from './settings.js';
import type { ShellConfiguration, ShellType } from '@google/gemini-cli-core';
import {
  type ShellProfileId,
  SHELL_PROFILE_REGISTRY,
  getShellProfile,
  getShellConfigurationFromProfile,
  getAllShellProfileIds,
  detectShellProfileFromEnv,
} from '@google/gemini-cli-core';

/**
 * Re-export ShellProfileId as ShellProfile for backwards compatibility.
 */
export type ShellProfile = ShellProfileId;

const normalizeExecutable = (executable: unknown): string | undefined => {
  if (typeof executable !== 'string') {
    return undefined;
  }
  const trimmed = executable.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeArgsPrefix = (argsPrefix: unknown): string[] | undefined => {
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
  const profileConfig = profile
    ? getShellConfigurationFromProfile(profile)
    : undefined;
  const executable =
    normalizeExecutable(settings.tools?.shell?.executable) ??
    profileConfig?.executable;
  const argsPrefix =
    normalizeArgsPrefix(settings.tools?.shell?.argsPrefix) ??
    profileConfig?.argsPrefix;
  const shell = (settings.tools?.shell?.shellType ??
    profileConfig?.shell) as ShellType | undefined;

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
    return profile ? getShellProfile(profile).guidance : undefined;
  }
  const trimmed = guidance.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return profile ? getShellProfile(profile).guidance : undefined;
}

export function resolveShellSearchCommandFromSettings(
  settings: Settings,
): string | undefined {
  const profile = settings.tools?.shell?.profile as ShellProfile | undefined;
  const searchCommand = settings.tools?.shell?.searchCommand;
  if (!searchCommand || typeof searchCommand !== 'string') {
    return profile ? getShellProfile(profile).searchCommand : undefined;
  }
  const trimmed = searchCommand.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return profile ? getShellProfile(profile).searchCommand : undefined;
}

export function resolveShellSearchGuidanceFromSettings(
  settings: Settings,
): string | undefined {
  const profile = settings.tools?.shell?.profile as ShellProfile | undefined;
  const guidance = settings.tools?.shell?.searchGuidance;
  if (!guidance || typeof guidance !== 'string') {
    // Use profile's searchGuidance if available
    return profile ? getShellProfile(profile).searchGuidance : undefined;
  }
  const trimmed = guidance.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveShellToolGuidanceFromSettings(
  settings: Settings,
): Record<string, string> | undefined {
  const profile = settings.tools?.shell?.profile as ShellProfile | undefined;
  const toolGuidance = settings.tools?.shell?.toolGuidance;

  // Start with profile defaults if available
  const profileDefaults = profile
    ? getShellProfile(profile).toolReplacements
    : undefined;

  if (!toolGuidance || typeof toolGuidance !== 'object') {
    // Return profile defaults if no custom guidance
    return profileDefaults;
  }

  const customEntries = Object.entries(toolGuidance).filter(
    ([key, value]) =>
      typeof key === 'string' &&
      key.trim().length > 0 &&
      typeof value === 'string' &&
      value.trim().length > 0,
  );

  if (customEntries.length === 0) {
    return profileDefaults;
  }

  // Merge custom entries with profile defaults (custom takes precedence)
  const customGuidance = Object.fromEntries(
    customEntries.map(([key, value]) => [key.trim(), value.trim()]),
  );

  if (profileDefaults) {
    return { ...profileDefaults, ...customGuidance };
  }

  return customGuidance;
}

/**
 * Detects the user's default shell from the $SHELL environment variable
 * and returns the matching profile, if any.
 *
 * @returns The detected shell profile, or undefined if not detected
 */
export function detectShellProfile(): ShellProfile | undefined {
  return detectShellProfileFromEnv();
}

/**
 * Returns all available shell profiles.
 */
export function getAvailableProfiles(): readonly ShellProfile[] {
  return getAllShellProfileIds();
}

/**
 * Returns the default guidance for a given profile.
 */
export function getProfileGuidance(profile: ShellProfile): string {
  return getShellProfile(profile).guidance;
}

/**
 * Returns the default shell configuration for a given profile.
 */
export function getProfileDefaults(
  profile: ShellProfile,
): Partial<ShellConfiguration> {
  return getShellConfigurationFromProfile(profile);
}

/**
 * Returns the full profile definition for advanced use cases.
 */
export function getFullProfileDefinition(profile: ShellProfile) {
  return getShellProfile(profile);
}

/**
 * Returns the shell profile registry for iteration/inspection.
 */
export function getProfileRegistry() {
  return SHELL_PROFILE_REGISTRY;
}
