#!/usr/bin/env node

/**
 * Fetch OpenAPI Specification Script (Generic)
 * ==========================================
 *
 * Description:
 *   Fetches an OpenAPI specification (YAML or JSON) from a given URL, parses it,
 *   and saves it in both YAML and JSON formats to a specified output file path.
 *   Includes fallback logic to try appending '/openapi.yaml' or '/openapi.json'
 *   if the initial URL doesn't yield a valid spec.
 *
 * Usage:
 *   ts-node --esm scripts/fetch-openapi-spec.ts <url> <output-base-path> [--help]
 *
 * Arguments:
 *   <url>                The base URL to fetch the OpenAPI spec from.
 *                        (e.g., https://api.example.com/v1 or https://api.example.com/v1/openapi.yaml)
 *   <output-base-path>   The base path for the output files (relative to project root).
 *                        The script will append '.yaml' and '.json' to this path.
 *                        (e.g., docs/api/example_spec)
 *   --help               Show this help message.
 *
 * Example:
 *   ts-node --esm scripts/fetch-openapi-spec.ts https://petstore3.swagger.io/api/v3 docs/api/petstore_v3
 *   -> Fetches from https://petstore3.swagger.io/api/v3/openapi.yaml (or .json)
 *   -> Saves to docs/api/petstore_v3.yaml and docs/api/petstore_v3.json
 *
 * Dependencies:
 *   - axios: For making HTTP requests.
 *   - js-yaml: For parsing and dumping YAML content.
 */

import axios, { AxiosError } from 'axios';
import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';

const projectRoot = process.cwd();

// --- Argument Parsing ---
const args = process.argv.slice(2);
const helpFlag = args.includes('--help');
const urlArg = args[0];
const outputBaseArg = args[1];

if (helpFlag || !urlArg || !outputBaseArg) {
  console.log(`
Fetch OpenAPI Specification Script

Usage:
  ts-node --esm scripts/fetch-openapi-spec.ts <url> <output-base-path> [--help]

Arguments:
  <url>                Base URL or direct URL to the OpenAPI spec (YAML/JSON).
  <output-base-path>   Base path for output files (relative to project root),
                       e.g., 'docs/api/my_api'. Will generate .yaml and .json.
  --help               Show this help message.

Example:
  ts-node --esm scripts/fetch-openapi-spec.ts https://petstore3.swagger.io/api/v3 docs/api/petstore_v3
`);
  process.exit(helpFlag ? 0 : 1);
}

const outputBasePathAbsolute = path.resolve(projectRoot, outputBaseArg);
const yamlOutputPath = `${outputBasePathAbsolute}.yaml`;
const jsonOutputPath = `${outputBasePathAbsolute}.json`;
const outputDirAbsolute = path.dirname(outputBasePathAbsolute);

// --- Security Check: Ensure output paths are within project root ---
if (!outputDirAbsolute.startsWith(projectRoot + path.sep) || !yamlOutputPath.startsWith(projectRoot + path.sep) || !jsonOutputPath.startsWith(projectRoot + path.sep)) {
    console.error(`× Security Error: Output path "${outputBaseArg}" resolves outside the project directory.`);
    process.exit(1);
}
// --- End Security Check ---


/**
 * Attempts to fetch content from a URL.
 */
async function tryFetch(url: string): Promise<{ data: string; contentType: string | null } | null> {
  try {
    console.log(`Attempting to fetch from ${url}...`);
    const response = await axios.get(url, {
      responseType: 'text',
      validateStatus: (status) => status >= 200 && status < 300, // Only consider 2xx successful
    });
    const contentType = response.headers['content-type'] || null;
    console.log(`  Success (Status: ${response.status}, Content-Type: ${contentType})`);
    return { data: response.data, contentType };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        console.warn(`  Failed (Status: ${axiosError.response.status})`);
      } else {
        console.warn(`  Failed (Network Error: ${axiosError.message})`);
      }
    } else {
      console.warn(`  Failed (Unknown Error: ${error instanceof Error ? error.message : String(error)})`);
    }
    return null;
  }
}

/**
 * Parses fetched data as YAML or JSON.
 */
function parseSpec(data: string, contentType: string | null): object | null {
  try {
    if (contentType?.includes('yaml') || contentType?.includes('yml')) {
      console.log("Parsing as YAML...");
      return yaml.load(data) as object;
    } else if (contentType?.includes('json')) {
      console.log("Parsing as JSON...");
      return JSON.parse(data);
    } else {
      // Attempt YAML first, then JSON if content-type is ambiguous or missing
      console.log("Ambiguous content type, attempting YAML parse...");
      try {
        const parsedYaml = yaml.load(data) as object;
        if (parsedYaml && typeof parsedYaml === 'object') return parsedYaml;
      } catch (yamlError) {
        console.log("YAML parse failed, attempting JSON parse...");
        try {
            const parsedJson = JSON.parse(data);
            if (parsedJson && typeof parsedJson === 'object') return parsedJson;
        } catch (jsonError) {
            console.warn("Could not parse content as YAML or JSON.");
            return null;
        }
      }
    }
  } catch (parseError) {
    console.error(`× Error parsing specification: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
  }
  return null;
}


/**
 * Main function to fetch, parse, and save the specification.
 */
async function fetchAndProcessSpec() {
  let fetchedData: { data: string; contentType: string | null } | null = null;
  const potentialUrls = [
    urlArg, // Try the original URL first
  ];

  // Add fallback URLs if the original doesn't explicitly end with .yaml or .json
  if (!urlArg.endsWith('.yaml') && !urlArg.endsWith('.yml') && !urlArg.endsWith('.json')) {
      const urlWithoutTrailingSlash = urlArg.endsWith('/') ? urlArg.slice(0, -1) : urlArg;
      potentialUrls.push(`${urlWithoutTrailingSlash}/openapi.yaml`);
      potentialUrls.push(`${urlWithoutTrailingSlash}/openapi.json`);
  }

  // Try fetching from potential URLs
  for (const url of potentialUrls) {
    fetchedData = await tryFetch(url);
    if (fetchedData) break; // Stop if fetch is successful
  }

  if (!fetchedData) {
    console.error(`× Failed to fetch specification from all attempted URLs: ${potentialUrls.join(', ')}`);
    process.exit(1);
  }

  // Parse the fetched data
  const openapiSpec = parseSpec(fetchedData.data, fetchedData.contentType);

  if (!openapiSpec || typeof openapiSpec !== 'object') {
    console.error("× Failed to parse specification content or content is not a valid object.");
    process.exit(1);
  }

  // Ensure the output directory exists
  try {
    await fs.access(outputDirAbsolute);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log(`Creating output directory: ${outputDirAbsolute}`);
      await fs.mkdir(outputDirAbsolute, { recursive: true });
    } else {
      console.error(`× Error accessing output directory ${outputDirAbsolute}: ${error.message}`);
      process.exit(1);
    }
  }

  // Save as YAML
  try {
    console.log(`Saving YAML spec to ${yamlOutputPath}...`);
    await fs.writeFile(yamlOutputPath, yaml.dump(openapiSpec), 'utf8');
    console.log(`✓ YAML saved.`);
  } catch (error) {
    console.error(`× Error saving YAML to ${yamlOutputPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // Save as JSON
  try {
    console.log(`Saving JSON spec to ${jsonOutputPath}...`);
    await fs.writeFile(jsonOutputPath, JSON.stringify(openapiSpec, null, 2), 'utf8');
    console.log(`✓ JSON saved.`);
  } catch (error) {
    console.error(`× Error saving JSON to ${jsonOutputPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.log("✓ OpenAPI specification processed successfully.");
}

// Execute the main function
fetchAndProcessSpec();
