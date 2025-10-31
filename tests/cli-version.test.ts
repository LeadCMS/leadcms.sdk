/**
 * Tests for CLI version command
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const CLI_PATH = path.resolve(__dirname, '../dist/cli/index.js');

describe('CLI Version Command', () => {
  it('should display version with "version" command', () => {
    const output = execSync(`node ${CLI_PATH} version`, { encoding: 'utf8' });
    expect(output).toContain('LeadCMS SDK v');
    expect(output).toMatch(/\d+\.\d+\.\d+/); // Matches semantic version
  });

  it('should display version with "-v" flag', () => {
    const output = execSync(`node ${CLI_PATH} -v`, { encoding: 'utf8' });
    expect(output).toContain('LeadCMS SDK v');
    expect(output).toMatch(/\d+\.\d+\.\d+/);
  });

  it('should display version with "--version" flag', () => {
    const output = execSync(`node ${CLI_PATH} --version`, { encoding: 'utf8' });
    expect(output).toContain('LeadCMS SDK v');
    expect(output).toMatch(/\d+\.\d+\.\d+/);
  });

  it('should match package.json version', () => {
    const packageJsonPath = path.resolve(__dirname, '../package.json');
    const packageJson = require(packageJsonPath);
    const output = execSync(`node ${CLI_PATH} version`, { encoding: 'utf8' });

    expect(output).toContain(`v${packageJson.version}`);
  });

  it('should exit with code 0', () => {
    const result = execSync(`node ${CLI_PATH} --version`, { encoding: 'utf8' });
    expect(result).toBeTruthy(); // Command executed successfully
  });
});
