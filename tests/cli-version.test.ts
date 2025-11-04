/**
 * Tests for CLI version command
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const CLI_PATH = path.resolve(__dirname, '../dist/cli/index.js');

describe('CLI Version Command', () => {
  // Check if CLI is built before running tests
  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(
        `CLI not built. Run 'npm run build' before running tests. Expected file: ${CLI_PATH}`
      );
    }
  });

  it('should display version with "version" command', () => {
    try {
      const output = execSync(`node ${CLI_PATH} version`, { encoding: 'utf8' });
      expect(output).toContain('LeadCMS SDK v');
      expect(output).toMatch(/\d+\.\d+\.\d+/); // Matches semantic version
    } catch (error) {
      throw new Error(`Failed to execute CLI: ${error instanceof Error ? error.message : error}`);
    }
  });

  it('should display version with "-v" flag', () => {
    try {
      const output = execSync(`node ${CLI_PATH} -v`, { encoding: 'utf8' });
      expect(output).toContain('LeadCMS SDK v');
      expect(output).toMatch(/\d+\.\d+\.\d+/);
    } catch (error) {
      throw new Error(`Failed to execute CLI: ${error instanceof Error ? error.message : error}`);
    }
  });

  it('should display version with "--version" flag', () => {
    try {
      const output = execSync(`node ${CLI_PATH} --version`, { encoding: 'utf8' });
      expect(output).toContain('LeadCMS SDK v');
      expect(output).toMatch(/\d+\.\d+\.\d+/);
    } catch (error) {
      throw new Error(`Failed to execute CLI: ${error instanceof Error ? error.message : error}`);
    }
  });

  it('should match package.json version', () => {
    try {
      const packageJsonPath = path.resolve(__dirname, '../package.json');
      const packageJson = require(packageJsonPath);
      const output = execSync(`node ${CLI_PATH} version`, { encoding: 'utf8' });

      expect(output).toContain(`v${packageJson.version}`);
    } catch (error) {
      throw new Error(`Failed to execute CLI: ${error instanceof Error ? error.message : error}`);
    }
  });

  it('should exit with code 0', () => {
    try {
      const result = execSync(`node ${CLI_PATH} --version`, { encoding: 'utf8' });
      expect(result).toBeTruthy(); // Command executed successfully
    } catch (error) {
      throw new Error(`Failed to execute CLI: ${error instanceof Error ? error.message : error}`);
    }
  });
});
