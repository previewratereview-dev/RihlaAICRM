/**
 * StateAI AI Operating System (AIOS) — Plugin Extension API
 * 
 * Modular extension architecture allowing external domain plugins (Voice, OCR,
 * Calendar, ERP, Inventory) to attach lifecycle hooks and event listeners
 * without modifying core AIOS source code.
 */

import type { AIOSContainer } from '../container';
import type { AIOSEvent } from '../events';

export interface PluginVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly tag?: string;
}

export interface AIOSPlugin {
  readonly id: string;
  readonly name: string;
  readonly version: PluginVersion;
  readonly dependencies?: string[]; // IDs of required plugins

  register(container: AIOSContainer): void | Promise<void>;
  onLoad?(): void | Promise<void>;
  onUnload?(): void | Promise<void>;
  onEvent?(event: AIOSEvent): void | Promise<void>;
}

export interface PluginManager {
  registerPlugin(plugin: AIOSPlugin): Promise<void>;
  unregisterPlugin(pluginId: string): Promise<boolean>;
  getPlugin(pluginId: string): AIOSPlugin | undefined;
  listPlugins(): AIOSPlugin[];
  loadAll(): Promise<void>;
  unloadAll(): Promise<void>;
}

export class DefaultPluginManager implements PluginManager {
  private plugins: Map<string, AIOSPlugin> = new Map();
  private loaded = false;
  private containerRef?: AIOSContainer;

  constructor(container?: AIOSContainer) {
    this.containerRef = container;
  }

  setContainer(container: AIOSContainer): void {
    this.containerRef = container;
  }

  async registerPlugin(plugin: AIOSPlugin): Promise<void> {
    const id = plugin.id.toLowerCase();
    this.plugins.set(id, plugin);

    if (this.containerRef) {
      await plugin.register(this.containerRef);
    }

    if (this.loaded && plugin.onLoad) {
      await plugin.onLoad();
    }
  }

  async unregisterPlugin(pluginId: string): Promise<boolean> {
    const id = pluginId.toLowerCase();
    const plugin = this.plugins.get(id);
    if (!plugin) return false;

    if (this.loaded && plugin.onUnload) {
      await plugin.onUnload();
    }

    return this.plugins.delete(id);
  }

  getPlugin(pluginId: string): AIOSPlugin | undefined {
    return this.plugins.get(pluginId.toLowerCase());
  }

  listPlugins(): AIOSPlugin[] {
    return Array.from(this.plugins.values());
  }

  async loadAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onLoad) {
        await plugin.onLoad();
      }
    }
    this.loaded = true;
  }

  async unloadAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onUnload) {
        await plugin.onUnload();
      }
    }
    this.loaded = false;
  }
}

export const defaultPluginManager = new DefaultPluginManager();
