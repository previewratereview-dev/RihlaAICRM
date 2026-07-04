/**
 * StateAI AI Operating System (AIOS) — Context Builder (Legacy Re-export)
 * 
 * Re-exports ContextEngine as ContextBuilder for backwards compatibility.
 */

export * from './engine';
export { ContextEngine as ContextBuilder, defaultContextEngine as defaultContextBuilder } from './engine';
