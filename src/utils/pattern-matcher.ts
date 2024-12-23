/**
 * Pattern matching utilities for task paths
 */
import { sep } from 'path';

// Convert path separator to forward slash for consistent pattern matching
const normalizePath = (path: string): string => path.split(sep).join('/');
// Convert pattern to use forward slashes
const normalizePattern = (pattern: string): string => pattern.split(sep).join('/');

/**
 * Converts a glob pattern to a regular expression
 * Supports:
 * - * for single level matching
 * - ** for recursive matching
 * - ? for single character matching
 */
export function globToRegex(pattern: string): RegExp {
    const normalizedPattern = normalizePattern(pattern);
    const escapedPattern = normalizedPattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
        .replace(/\*\*/g, '{{RECURSIVE}}') // Temp placeholder for **
        .replace(/\*/g, '[^/]+') // * matches anything except /
        .replace(/\?/g, '.') // ? matches single char
        .replace(/{{RECURSIVE}}/g, '.*'); // ** matches anything including /

    return new RegExp(`^${escapedPattern}$`);
}

/**
 * Converts a glob pattern to an SQL LIKE/GLOB pattern
 */
export function globToSqlPattern(pattern: string): string {
    // Handle special case of root pattern
    if (normalizePattern(pattern) === '**') {
        return '%';
    }

    // Escape special characters for GLOB
    let sqlPattern = pattern
        .replace(/([%_])/g, '\\$1') // Escape SQL wildcards
        .replace(/\*\*/g, '{{RECURSIVE}}') // Temp placeholder for **
        .replace(/\*/g, '*') // Keep * for GLOB
        .replace(/\?/g, '?') // Keep ? for GLOB
        .replace(/{{RECURSIVE}}/g, '*'); // ** becomes * for recursive GLOB

    // If pattern ends with **, append * to match all children
    if (pattern.endsWith('**')) {
        sqlPattern = sqlPattern.slice(0, -1) + '*';
    }

    return sqlPattern;
}

/**
 * Generates all possible glob patterns for a given path
 * Example: "a/b/c" generates:
 * - "a/b/c"
 * - "a/b/*"
 * - "a/*\/c"
 * - "a/**"
 * - "*\/b/c"
 * - etc.
 */
export function generatePathPatterns(path: string): string[] {
    const segments = normalizePath(path).split('/');
    const patterns: Set<string> = new Set();

    // Add exact path
    patterns.add(path);

    // Add single wildcard patterns
    for (let i = 0; i < segments.length; i++) {
        const pattern = [
            ...segments.slice(0, i),
            '*',
            ...segments.slice(i + 1)
        ].join('/');
        patterns.add(pattern);
    }

    // Add recursive patterns
    for (let i = 0; i < segments.length - 1; i++) {
        const pattern = [...segments.slice(0, i), '**'].join('/');
        patterns.add(pattern);
    }

    // Add combinations of * and **
    for (let i = 0; i < segments.length - 1; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            const pattern = [
                ...segments.slice(0, i),
                '*',
                ...segments.slice(i + 1, j),
                '**'
            ].join('/');
            patterns.add(pattern);
        }
    }

    return Array.from(patterns);
}

/**
 * Tests if a path matches a glob pattern
 */
export function matchesPattern(path: string, pattern: string): boolean {
    const normalizedPath = normalizePath(path);
    return globToRegex(pattern).test(normalizedPath);
}
