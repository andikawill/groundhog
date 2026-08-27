// Next compiles a side-effect stylesheet import; TypeScript refuses one it has no
// declaration for (TS2882). next-env.d.ts does not cover it, so this does.
declare module '*.css'
