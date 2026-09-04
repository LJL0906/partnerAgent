import { Injectable } from '@nestjs/common';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { getCurrentTimeTool } from '../agent/tools/current-time.tool.js';
import type { RegisteredTool } from './tool.types.js';

@Injectable()
export class ToolRegistryService {
  private readonly definitions = new Map<string, RegisteredTool>();

  constructor() {
    this.register({
      tool: getCurrentTimeTool,
      riskLevel: 'read_only',
      effect: 'read_only',
      capabilities: ['read_runtime'],
      requiredPermissions: [],
      requiresToolApproval: false,
    });
  }

  register(definition: RegisteredTool): void {
    if (this.definitions.has(definition.tool.name)) {
      throw new Error(`工具重复注册: ${definition.tool.name}`);
    }
    this.assertBoundary(definition);
    this.definitions.set(definition.tool.name, definition);
  }

  get(name: string): RegisteredTool {
    const definition = this.definitions.get(name);
    if (!definition) throw new Error(`工具未注册: ${name}`);
    return definition;
  }

  list(): RegisteredTool[] {
    return [...this.definitions.values()];
  }

  isToolApprovalRequired(name: string): boolean {
    return this.get(name).requiresToolApproval;
  }

  toPublicTool(
    definition: RegisteredTool,
    execute: AgentTool['execute'],
  ): AgentTool {
    return {
      name: definition.tool.name,
      label: definition.tool.label,
      description: definition.tool.description,
      parameters: definition.tool.parameters,
      execute,
    };
  }

  private assertBoundary(definition: RegisteredTool): void {
    if (definition.effect === 'read_only') {
      if (definition.riskLevel !== 'read_only') {
        throw new Error(
          `只读工具必须标记为 read_only: ${definition.tool.name}`,
        );
      }
      if (
        definition.capabilities.includes('external_api') ||
        definition.capabilities.includes('generate_candidate_batch')
      ) {
        throw new Error(`只读工具声明了写能力: ${definition.tool.name}`);
      }
      if (definition.requiresToolApproval || definition.undo) {
        throw new Error(
          `只读工具不能配置副作用审批或撤销: ${definition.tool.name}`,
        );
      }
      return;
    }

    if (definition.effect === 'formal_business_data') {
      if (definition.riskLevel === 'read_only') {
        throw new Error(
          `正式业务候选工具不能标记为 read_only: ${definition.tool.name}`,
        );
      }
      if (definition.capabilities.includes('external_api')) {
        throw new Error(
          `正式业务工具不得声明外部副作用能力: ${definition.tool.name}`,
        );
      }
      if (!definition.capabilities.includes('generate_candidate_batch')) {
        throw new Error(
          `正式业务工具必须声明候选批次能力: ${definition.tool.name}`,
        );
      }
      if (!definition.createCandidateBatch) {
        throw new Error(
          `正式业务工具只能通过 Candidate/Batch 适配器注册: ${definition.tool.name}`,
        );
      }
      if (definition.requiresToolApproval || definition.undo) {
        throw new Error(
          `正式业务工具不得接入外部 Tool Approval/Undo: ${definition.tool.name}`,
        );
      }
      return;
    }

    if (!definition.capabilities.includes('external_api')) {
      throw new Error(
        `外部副作用工具必须声明 external_api 能力: ${definition.tool.name}`,
      );
    }
    if (!definition.requiresToolApproval) {
      throw new Error(
        `外部副作用工具必须进入 Tool Approval: ${definition.tool.name}`,
      );
    }
    if (definition.riskLevel === 'read_only') {
      throw new Error(
        `外部副作用工具不能标记为 read_only: ${definition.tool.name}`,
      );
    }
  }
}
