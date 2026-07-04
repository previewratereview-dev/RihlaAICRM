/**
 * StateAI AI Operating System (AIOS) — Tool Validator
 * 
 * Strict Zod schema validation for tool inputs and outputs.
 * Catches malformed arguments or invalid return payloads before execution.
 */

import { z } from 'zod';
import type { AIOSTool } from './types';
import { ProviderConfigurationError } from '../errors';

export class ToolValidationError extends ProviderConfigurationError {
  readonly issues: z.ZodIssue[];

  constructor(toolId: string, type: 'input' | 'output', issues: z.ZodIssue[]) {
    const summary = issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    super('tool', `Tool '${toolId}' ${type} validation failed: ${summary}`);
    this.name = 'ToolValidationError';
    this.issues = issues;
  }
}

export class ToolValidator {
  /**
   * Validate input parameters against the tool's inputSchema.
   */
  validateInput<TInput>(tool: AIOSTool<TInput, any>, input: unknown): TInput {
    const result = tool.inputSchema.safeParse(input);
    if (!result.success) {
      throw new ToolValidationError(tool.id, 'input', result.error.issues);
    }
    return result.data;
  }

  /**
   * Validate output payload against the tool's outputSchema (if defined).
   */
  validateOutput<TOutput>(tool: AIOSTool<any, TOutput>, output: unknown): TOutput {
    if (!tool.outputSchema) {
      return output as TOutput;
    }
    const result = tool.outputSchema.safeParse(output);
    if (!result.success) {
      throw new ToolValidationError(tool.id, 'output', result.error.issues);
    }
    return result.data;
  }
}

export const defaultToolValidator = new ToolValidator();
