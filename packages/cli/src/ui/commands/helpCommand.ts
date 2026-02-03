/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import { MessageType, type HistoryItemHelp } from '../types.js';

export const helpCommand: SlashCommand = {
  name: 'help',
  altNames: ['?'],
  kind: CommandKind.BUILT_IN,
  description: 'For help on gemini-cli',
  autoExecute: true,
  action: async (context) => {
    const config = context.services.config;
    const shellConfig = config?.getShellConfiguration();
    const shellInfo = shellConfig
      ? {
          executable: shellConfig.executable,
          argsPrefix: shellConfig.argsPrefix,
          shell: shellConfig.shell,
          guidance: config?.getShellGuidance(),
          searchCommand: config?.getShellSearchCommand(),
          searchGuidance: config?.getShellSearchGuidance(),
          toolGuidance: config?.getShellToolGuidance(),
        }
      : undefined;
    const helpItem: Omit<HistoryItemHelp, 'id'> = {
      type: MessageType.HELP,
      timestamp: new Date(),
      shellInfo,
    };

    context.ui.addItem(helpItem);
  },
};
