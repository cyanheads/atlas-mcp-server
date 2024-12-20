/**
 * Pattern matching utilities for task paths
 */

/**
 * Converts a glob pattern to a regular expression
 * Supports:
 * - * for single level matching
 * - ** for recursive matching
 * - ? for single character matching
 */
export function globToRegex(pattern: string): RegExp {
    const escapedPattern = pattern
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
    return pattern
        .replace(/\*\*/g, '%') // ** for recursive match
        .replace(/\*/g, '%') // * for single level match
        .replace(/\?/g, '_'); // ? for single character
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
    const segments = path.split('/');
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
    return globToRegex(pattern).test(path);
}
