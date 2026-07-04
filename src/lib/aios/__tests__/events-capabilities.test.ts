import { describe, it, expect } from 'vitest';
import { defaultEventBus, DefaultEventBus } from '../events';
import { defaultCapabilityRegistry, CapabilityRegistry } from '../capabilities';
import { defaultFeatureFlagManager } from '../security';

describe('Events, Capabilities & Feature Flags', () => {
  describe('EventBus', () => {
    it('should subscribe and receive published events asynchronously', async () => {
      const bus = new DefaultEventBus();
      let receivedPayload: any = null;

      bus.subscribe('test.event', (evt) => {
        receivedPayload = evt.payload;
      });

      await bus.publish('test.event', { foo: 'bar' }, { traceId: 'trace_123' });
      expect(receivedPayload).toEqual({ foo: 'bar' });
    });

    it('should receive events on wildcard (*) subscription', async () => {
      const bus = new DefaultEventBus();
      let count = 0;

      bus.subscribe('*', () => {
        count++;
      });

      await bus.publish('evt1', {});
      await bus.publish('evt2', {});
      expect(count).toBe(2);
    });
  });

  describe('CapabilityRegistry', () => {
    it('should register and query default capabilities', () => {
      const registry = new CapabilityRegistry();
      expect(registry.hasCapability('tool_calling')).toBe(true);
      expect(registry.hasCapability('vision')).toBe(true);
      expect(registry.getCapability('reasoning')?.category).toBe('reasoning');
    });
  });

  describe('FeatureFlagManager', () => {
    it('should return global defaults and tenant overrides', () => {
      expect(defaultFeatureFlagManager.isEnabled('tenant-A', 'enablePlanner')).toBe(true);
      
      defaultFeatureFlagManager.setFlag('tenant-A', 'enablePlanner', false);
      expect(defaultFeatureFlagManager.isEnabled('tenant-A', 'enablePlanner')).toBe(false);
      expect(defaultFeatureFlagManager.isEnabled('tenant-B', 'enablePlanner')).toBe(true);
    });
  });
});
