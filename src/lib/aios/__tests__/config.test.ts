import { describe, it, expect, beforeEach } from 'vitest';
import { getAIOSConfig, updateAIOSConfig, resetAIOSConfig, getProviderConfig } from '../config';

describe('AIOS Configuration', () => {
  beforeEach(() => {
    resetAIOSConfig();
  });

  it('should load default configuration without hardcoded failures', () => {
    const config = getAIOSConfig();
    expect(config.defaults.chatModel).toBeDefined();
    expect(config.defaults.temperature).toBeTypeOf('number');
    expect(config.providers.openai).toBeDefined();
    expect(config.providers.nvidia).toBeDefined();
    expect(config.providers.anthropic).toBeDefined();
    expect(config.providers.glm).toBeDefined();
    expect(config.providers.ollama).toBeDefined();
  });

  it('should update configuration dynamically at runtime', () => {
    const updated = updateAIOSConfig({
      defaults: {
        chatModel: 'meta/llama-3.3-70b-instruct',
        temperature: 0.2,
      },
      providers: {
        nvidia: {
          apiKey: 'test-nvidia-key',
          timeoutMs: 45000,
        },
      },
    });

    expect(updated.defaults.chatModel).toBe('meta/llama-3.3-70b-instruct');
    expect(updated.defaults.temperature).toBe(0.2);
    expect(updated.providers.nvidia.apiKey).toBe('test-nvidia-key');
    expect(updated.providers.nvidia.timeoutMs).toBe(45000);
  });

  it('should retrieve defensive copies to prevent direct mutation', () => {
    const config1 = getAIOSConfig();
    config1.defaults.chatModel = 'mutated-model';
    
    const config2 = getAIOSConfig();
    expect(config2.defaults.chatModel).not.toBe('mutated-model');
  });

  it('should resolve provider configuration by name', () => {
    updateAIOSConfig({
      providers: {
        anthropic: {
          apiKey: 'test-anthropic-key',
        },
      },
    });

    const anthropicCfg = getProviderConfig('anthropic');
    expect(anthropicCfg.apiKey).toBe('test-anthropic-key');

    const unknownCfg = getProviderConfig('unknown-provider');
    expect(unknownCfg.enabled).toBe(false);
  });
});
