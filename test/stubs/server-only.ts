// Test stub for the `server-only` marker module.
//
// `server-only` is provided by Next.js at build time via the `react-server`
// export condition and is not resolvable in a plain Node/Vitest environment.
// Aliasing it to this empty module lets unit tests import server-only services
// (e.g. `src/lib/users/service.ts`) without pulling in the Next.js bundler.
export {};
