# CI/CD Setup Guide

This guide helps you set up comprehensive testing and coverage reporting for the LeadCMS SDK.

## GitHub Actions Workflows

The repository includes a comprehensive Build & Test workflow:

### Build & Test Workflow (`.github/workflows/build-and-test.yml`)
- **Purpose**: Complete test, build, and validation pipeline
- **Triggers**: Push to main/develop, Pull Requests
- **Features**:
  - Multi-Node.js version testing (18, 20, 22)
  - Jest test execution with coverage reporting
  - Package building and validation
  - CLI functionality testing
  - Docker template generation testing
  - TypeScript compilation checking
  - JUnit XML test result reporting
  - Coverage artifacts and PR comments

## Test Result Visibility

### In GitHub Actions
1. **Test Summary**: Visible in the Actions run summary page
2. **Test Reporter**: Detailed test results with pass/fail status for each test
3. **Coverage Reports**: HTML coverage reports archived as artifacts
4. **PR Comments**: Automatic coverage change comments on pull requests

### Viewing Test Results
- Go to the GitHub repository > Actions tab
- Click on any test run to see detailed results
- Download coverage artifacts for local viewing
- Check PR comments for coverage changes

## Coverage Integration

The workflows provide comprehensive coverage reporting without requiring external services:

1. **Local Coverage**: HTML reports generated in `coverage/` directory
2. **GitHub Artifacts**: Coverage reports archived for 30 days
3. **PR Comments**: Automatic coverage change comments on pull requests
4. **Multiple Formats**: LCOV, HTML, and Clover formats available

## Local Development

### Running Tests
```bash
# Install dependencies
npm ci

# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode (for development)
npm run test:watch
```

### Coverage Reports
After running `npm run test:coverage`, you can:
- View text coverage in the terminal
- Open `coverage/lcov-report/index.html` in your browser for detailed HTML report
- Check `coverage/lcov.info` for raw coverage data

### Test Configuration
The Jest configuration is in `jest.config.js` and includes:
- TypeScript support via `ts-jest`
- Coverage collection from `src/**/*.ts` files
- JUnit XML output for CI integration
- HTML and LCOV coverage reporting

## Badge Integration

Add these badges to your README to show CI status:

```markdown
[![Build & Test](https://github.com/LeadCMS/leadcms.sdk/actions/workflows/build-and-test.yml/badge.svg)](https://github.com/LeadCMS/leadcms.sdk/actions/workflows/build-and-test.yml)
[![Publish](https://github.com/LeadCMS/leadcms.sdk/actions/workflows/publish.yml/badge.svg)](https://github.com/LeadCMS/leadcms.sdk/actions/workflows/publish.yml)
```

## Troubleshooting

### Common Issues
1. **Tests fail locally but pass in CI**: Check Node.js version compatibility
2. **Coverage reports not generated**: Ensure `jest-junit` is installed
3. **JUnit XML missing**: Verify Jest configuration includes reporters section
4. **PR comments not appearing**: Check if `GITHUB_TOKEN` has proper permissions

### Debug Commands
```bash
# Verify Jest configuration
npx jest --showConfig

# Run tests with verbose output
npm test -- --verbose

# Generate coverage without running all tests
npm run test:coverage -- --collectCoverageOnlyFrom="src/lib/cms.ts"
```
