/// <reference types="vite/client" />

// Injected by Vite from package.json at build time, so the version a rep
// reads on the Me screen is the version that was released rather than one
// somebody remembered to update by hand.
declare const __APP_VERSION__: string;

declare module '*.css';
