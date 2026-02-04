/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCoreSystemPrompt } from './prompts.js';
import fs from 'node:fs';
import type { Config } from '../config/config.js';
import * as toolNames from '../tools/tool-names.js';

vi.mock('node:fs');
vi.mock('../utils/gitUtils', () => ({
  isGitRepository: vi.fn().mockReturnValue(false),
}));

describe('Core System Prompt Substitution', () => {
  let mockConfig: Config;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('GEMINI_SYSTEM_MD', 'true');
    mockConfig = {
      getToolRegistry: vi.fn().mockReturnValue({
        getAllToolNames: vi
          .fn()
          .mockReturnValue([
            toolNames.WRITE_FILE_TOOL_NAME,
            toolNames.READ_FILE_TOOL_NAME,
          ]),
      }),
      getEnableShellOutputEfficiency: vi.fn().mockReturnValue(true),
      storage: {
        getProjectTempDir: vi.fn().mockReturnValue('/tmp/project-temp'),
      },
      isInteractive: vi.fn().mockReturnValue(true),
      isInteractiveShellEnabled: vi.fn().mockReturnValue(true),
      isAgentsEnabled: vi.fn().mockReturnValue(false),
      getModel: vi.fn().mockReturnValue('auto'),
      getActiveModel: vi.fn().mockReturnValue('gemini-1.5-pro'),
      getPreviewFeatures: vi.fn().mockReturnValue(false),
      getAgentRegistry: vi.fn().mockReturnValue({
        getDirectoryContext: vi.fn().mockReturnValue('Mock Agent Directory'),
      }),
      getSkillManager: vi.fn().mockReturnValue({
        getSkills: vi.fn().mockReturnValue([]),
      }),
      getShellConfiguration: vi.fn().mockReturnValue({
        executable: 'bash',
        argsPrefix: ['-c'],
        shell: 'bash',
      }),
      getShellGuidance: vi.fn().mockReturnValue(undefined),
      getShellSearchCommand: vi.fn().mockReturnValue(undefined),
      getShellSearchGuidance: vi.fn().mockReturnValue(undefined),
      getShellToolGuidance: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;
  });

  it('should preserve ${AgentSkills} in custom system prompt (no substitution)', () => {
    const skills = [
      {
        name: 'test-skill',
        description: 'A test skill description',
        location: '/path/to/test-skill/SKILL.md',
        body: 'Skill content',
      },
    ];
    vi.mocked(mockConfig.getSkillManager().getSkills).mockReturnValue(skills);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      'Skills go here: ${AgentSkills}',
    );

    const prompt = getCoreSystemPrompt(mockConfig);

    // Custom system prompts are used as-is without substitution
    expect(prompt).toBe('Skills go here: ${AgentSkills}');
  });

  it('should preserve ${SubAgents} in custom system prompt (no substitution)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('Agents: ${SubAgents}');
    vi.mocked(
      mockConfig.getAgentRegistry().getDirectoryContext,
    ).mockReturnValue('Actual Agent Directory');

    const prompt = getCoreSystemPrompt(mockConfig);

    // Custom system prompts are used as-is without substitution
    expect(prompt).toBe('Agents: ${SubAgents}');
  });

  it('should preserve ${AvailableTools} in custom system prompt (no substitution)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('Tools:\n${AvailableTools}');

    const prompt = getCoreSystemPrompt(mockConfig);

    // Custom system prompts are used as-is without substitution
    expect(prompt).toBe('Tools:\n${AvailableTools}');
  });

  it('should preserve ${toolName}_ToolName patterns in custom system prompt (no substitution)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      'Use ${write_file_ToolName} and ${read_file_ToolName}.',
    );

    const prompt = getCoreSystemPrompt(mockConfig);

    // Custom system prompts are used as-is without substitution
    expect(prompt).toBe('Use ${write_file_ToolName} and ${read_file_ToolName}.');
  });

  it('should not substitute old patterns', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      '${WriteFileToolName} and ${WRITE_FILE_TOOL_NAME}',
    );

    const prompt = getCoreSystemPrompt(mockConfig);

    expect(prompt).toBe('${WriteFileToolName} and ${WRITE_FILE_TOOL_NAME}');
  });

  it('should not substitute disabled tool names', () => {
    vi.mocked(mockConfig.getToolRegistry().getAllToolNames).mockReturnValue([]);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('Use ${write_file_ToolName}.');

    const prompt = getCoreSystemPrompt(mockConfig);

    expect(prompt).toBe('Use ${write_file_ToolName}.');
  });
});
