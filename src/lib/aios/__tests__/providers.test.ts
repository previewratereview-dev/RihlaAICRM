import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../providers/openai-compatible';
import { AnthropicProvider } from '../providers/anthropic';
import { ProviderConfigurationError } from '../errors';

describe('LLM Provider Adapters', () => {
  describe('OpenAICompatibleProvider', () => {
    it('should initialize with correct capabilities and models', () => {
      const provider = new OpenAICompatibleProvider({
        id: 'nvidia',
        name: 'NVIDIA AI Foundation',
        baseUrl: 'https://integrate.api.nvidia.com/v1',
        supportedModels: ['meta/llama-3.3-70b-instruct'],
      });

      expect(provider.id).toBe('nvidia');
      expect(provider.name).toBe('NVIDIA AI Foundation');
      const caps = provider.getCapabilities();
      expect(caps.supportsToolCalling).toBe(true);
      expect(caps.supportedModels).toContain('meta/llama-3.3-70b-instruct');
    });

    it('should throw ProviderConfigurationError when calling complete without API key (unless Ollama)', async () => {
      const provider = new OpenAICompatibleProvider({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
      });

      await expect(
        provider.complete({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow(ProviderConfigurationError);
    });

    it('should allow Ollama execution without API key', async () => {
      const provider = new OpenAICompatibleProvider({
        id: 'ollama',
        name: 'Ollama Local',
        baseUrl: 'http://localhost:11434/v1',
      });

      const caps = provider.getCapabilities();
      expect(caps.supportsChat).toBe(true);
    });
  });

  describe('AnthropicProvider', () => {
    it('should initialize with correct Anthropic capabilities', () => {
      const provider = new AnthropicProvider({
        apiKey: 'test-key',
      });

      expect(provider.id).toBe('anthropic');
      const caps = provider.getCapabilities();
      expect(caps.supportsEmbeddings).toBe(false); // Anthropic does not support embeddings
      expect(caps.supportsToolCalling).toBe(true);
    });

    it('should report initial health status as unknown or healthy', () => {
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      const health = provider.getHealth();
      expect(health.status).toBe('unknown');
      expect(health.availabilityPercentage).toBe(100);
    });
  });
});
