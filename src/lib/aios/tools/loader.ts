/**
 * StateAI AI Operating System (AIOS) — Dynamic Tool Loader
 * 
 * Dynamically discovers and registers vertical CRM tools and standard capabilities
 * into the authoritative ToolRegistry.
 */

import type { ToolCategory } from './types';
import { defaultToolRegistry, type ToolRegistry } from './registry';
import { createLeadTool, updateLeadTool, deleteLeadTool } from './builtin/crm-tools';
import { searchFlightsTool, bookHotelTool, cancelBookingTool } from './builtin/travel-tools';

export class ToolLoader {
  private registry: ToolRegistry;
  private builtInTools = [
    createLeadTool,
    updateLeadTool,
    deleteLeadTool,
    searchFlightsTool,
    bookHotelTool,
    cancelBookingTool,
  ];

  constructor(registry: ToolRegistry = defaultToolRegistry) {
    this.registry = registry;
  }

  /**
   * Load all standard built-in AIOS tools across all industries into the registry.
   */
  loadAllBuiltInTools(): void {
    for (const tool of this.builtInTools) {
      this.registry.registerTool(tool);
    }
  }

  /**
   * Load tools belonging to a specific category.
   */
  loadCategory(category: ToolCategory): void {
    for (const tool of this.builtInTools) {
      if (tool.category === category) {
        this.registry.registerTool(tool);
      }
    }
  }

  /**
   * Load tools tailored for a specific industry vertical (e.g., 'Travel CRM', 'CRM').
   */
  loadIndustry(industry: string): void {
    const cleanInd = industry.toLowerCase();
    for (const tool of this.builtInTools) {
      if (tool.industry && tool.industry.toLowerCase() === cleanInd) {
        this.registry.registerTool(tool);
      }
    }
  }
}

export const defaultToolLoader = new ToolLoader();
