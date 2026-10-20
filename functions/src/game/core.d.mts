// Type declarations for the vendored game module (the .mjs itself is copied verbatim).
export const CONTENT_VERSION: number;
export function hash(s: string): number;
export function makeRuntimeBoard(o: { seed: string; category: number; p: any; fallback?: any; maxAttempts?: number }): Promise<any>;
export function validateBoard(board: any): string[];
export function pathBetween(a: { x: number; y: number }, b: { x: number; y: number }, size: any): { x: number; y: number }[];
export function pathKey(path: { x: number; y: number }[]): string;
export function textAt(grid: string[][], path: { x: number; y: number }[]): string;
export function boardDimensions(shape: any): { columns: number; rows: number };
