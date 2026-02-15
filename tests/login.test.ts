/**
 * Tests for login / authentication functionality
 * Tests real SDK auth functions from src/lib/auth.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import {
  verifyToken,
  saveTokenToEnv,
  getLeadCMSVersion,
  authenticate,
  manualTokenFlow,
  compareVersions,
  supportsDeviceAuth,
  deviceAuthFlow,
} from '../src/lib/auth';

// Mock axios at module level
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Login Flow (Real SDK Auth Functions)', () => {
  const testEnvDir = path.join(__dirname, '.test-login-env');
  const testEnvPath = path.join(testEnvDir, '.env');
  let originalCwd: () => string;

  beforeEach(() => {
    // Set up a temp directory to act as process.cwd() for saveTokenToEnv
    if (!fs.existsSync(testEnvDir)) {
      fs.mkdirSync(testEnvDir, { recursive: true });
    }
    // Mock process.cwd to point to our test directory
    originalCwd = process.cwd;
    jest.spyOn(process, 'cwd').mockReturnValue(testEnvDir);
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore cwd
    process.cwd = originalCwd;
    // Clean up test env directory
    if (fs.existsSync(testEnvDir)) {
      fs.rmSync(testEnvDir, { recursive: true, force: true });
    }
  });

  describe('verifyToken', () => {
    it('should call /api/users/me with Bearer token and return user details', async () => {
      const mockUser = {
        email: 'test@example.com',
        userName: 'testuser',
        displayName: 'Test User',
        id: '123',
      };

      mockedAxios.get.mockResolvedValue({ data: mockUser });

      const result = await verifyToken('https://test.leadcms.com', 'valid-token');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://test.leadcms.com/api/users/me',
        { headers: { Authorization: 'Bearer valid-token' } }
      );
      expect(result.email).toBe('test@example.com');
      expect(result.displayName).toBe('Test User');
      expect(result.userName).toBe('testuser');
    });

    it('should propagate 401 errors from the API', async () => {
      mockedAxios.get.mockRejectedValue({
        isAxiosError: true,
        response: { status: 401, statusText: 'Unauthorized' },
      });

      await expect(verifyToken('https://test.leadcms.com', 'invalid-token'))
        .rejects.toMatchObject({ response: { status: 401 } });
    });
  });

  describe('saveTokenToEnv', () => {
    it('should create a new .env file with LEADCMS_API_KEY', () => {
      saveTokenToEnv('test-token-123');

      const content = fs.readFileSync(testEnvPath, 'utf-8');
      expect(content).toContain('LEADCMS_API_KEY=test-token-123');
    });

    it('should update existing LEADCMS_API_KEY in .env file', () => {
      // Write initial .env with old token
      fs.writeFileSync(testEnvPath, 'LEADCMS_API_KEY=old-token\nOTHER_VAR=value\n', 'utf-8');

      saveTokenToEnv('new-token');

      const content = fs.readFileSync(testEnvPath, 'utf-8');
      expect(content).toContain('LEADCMS_API_KEY=new-token');
      expect(content).toContain('OTHER_VAR=value');
      expect(content).not.toContain('old-token');
    });

    it('should append LEADCMS_API_KEY to existing .env without it', () => {
      fs.writeFileSync(testEnvPath, 'OTHER_VAR=value\n', 'utf-8');

      saveTokenToEnv('new-token');

      const content = fs.readFileSync(testEnvPath, 'utf-8');
      expect(content).toContain('OTHER_VAR=value');
      expect(content).toContain('LEADCMS_API_KEY=new-token');
    });

    it('should handle empty .env file', () => {
      fs.writeFileSync(testEnvPath, '', 'utf-8');

      saveTokenToEnv('test-token');

      const content = fs.readFileSync(testEnvPath, 'utf-8');
      expect(content).toContain('LEADCMS_API_KEY=test-token');
    });
  });

  describe('getLeadCMSVersion', () => {
    it('should fetch and return version from /api/version', async () => {
      mockedAxios.get.mockResolvedValue({ data: { version: '1.3.17.0' } });

      const version = await getLeadCMSVersion('https://test.leadcms.com');

      expect(version).toBe('1.3.17.0');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://test.leadcms.com/api/version',
        expect.objectContaining({ timeout: 5000 })
      );
    });

    it('should return null on network error', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      const version = await getLeadCMSVersion('https://unreachable.com');

      expect(version).toBeNull();
    });
  });

  describe('authenticate (integration of version check + auth flow)', () => {
    it('should use manual token flow for old server versions', async () => {
      // Version check returns old version
      mockedAxios.get
        .mockResolvedValueOnce({ data: { version: '1.0.0' } }) // version check
        .mockResolvedValueOnce({                                  // verify token
          data: {
            email: 'user@test.com',
            userName: 'user',
            displayName: 'Test User',
          },
        });

      const mockQuestion = jest.fn((prompt: string) => Promise.resolve('manual-token'));

      const result = await authenticate('https://test.leadcms.com', mockQuestion);

      expect(result.token).toBe('manual-token');
      expect(result.user.email).toBe('user@test.com');
      expect(mockQuestion).toHaveBeenCalled();
    });

    it('should use manual flow when version check fails', async () => {
      // Version check fails
      mockedAxios.get
        .mockRejectedValueOnce(new Error('Network error'))      // version check fails
        .mockResolvedValueOnce({                                  // verify token
          data: {
            email: 'user@test.com',
            userName: 'user',
            displayName: 'Test User',
          },
        });

      const mockQuestion = jest.fn((prompt: string) => Promise.resolve('fallback-token'));

      const result = await authenticate('https://test.leadcms.com', mockQuestion);

      expect(result.token).toBe('fallback-token');
      expect(result.user.userName).toBe('user');
    });

    it('should use device auth for supported versions', async () => {
      const mockUser = {
        email: 'user@test.com',
        userName: 'user',
        displayName: 'Test User',
      };

      mockedAxios.get
        .mockResolvedValueOnce({ data: { version: '1.2.88' } })
        .mockResolvedValueOnce({ data: mockUser });

      mockedAxios.post
        .mockResolvedValueOnce({
          data: {
            deviceCode: 'device-123',
            userCode: 'USER-123',
            verificationUri: 'https://test.leadcms.com/verify',
            verificationUriComplete: 'https://test.leadcms.com/verify?code=USER-123',
            expiresIn: 600,
            interval: 0.001,
          },
        })
        .mockResolvedValueOnce({ status: 200, data: { token: 'device-token' } });

      const mockQuestion = jest.fn();
      const result = await authenticate('https://test.leadcms.com', mockQuestion);

      expect(result.token).toBe('device-token');
      expect(result.user.email).toBe('user@test.com');
      expect(mockQuestion).not.toHaveBeenCalled();
    });
  });

  describe('manualTokenFlow', () => {
    it('should return the token provided by the user', async () => {
      const mockQuestion = jest.fn((prompt: string) => Promise.resolve('user-provided-token'));

      const token = await manualTokenFlow('https://test.leadcms.com', mockQuestion);

      expect(token).toBe('user-provided-token');
      expect(mockQuestion).toHaveBeenCalledWith(expect.stringContaining('token'));
    });

    it('should throw if no token is provided', async () => {
      const mockQuestion = jest.fn((prompt: string) => Promise.resolve(''));

      await expect(manualTokenFlow('https://test.leadcms.com', mockQuestion))
        .rejects.toThrow('No token provided');
    });
  });
});

describe('compareVersions', () => {
  it('should return 1 when v1 > v2', () => {
    expect(compareVersions('1.2.89', '1.2.88')).toBe(1);
    expect(compareVersions('1.3.0', '1.2.99')).toBe(1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });

  it('should return -1 when v1 < v2', () => {
    expect(compareVersions('1.2.87', '1.2.88')).toBe(-1);
    expect(compareVersions('1.1.0', '1.2.0')).toBe(-1);
    expect(compareVersions('1.9.9', '2.0.0')).toBe(-1);
  });

  it('should return 0 when versions are equal', () => {
    expect(compareVersions('1.2.88', '1.2.88')).toBe(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });

  it('should handle pre-release versions', () => {
    expect(compareVersions('1.2.88-pre', '1.2.88')).toBe(0);
    expect(compareVersions('1.2.89-alpha.1', '1.2.88')).toBe(1);
  });

  it('should handle invalid version strings', () => {
    expect(compareVersions('invalid', '1.2.88')).toBe(-1);
    expect(compareVersions('1.2.88', 'invalid')).toBe(1);
    expect(compareVersions('invalid', 'invalid')).toBe(0);
  });
});

describe('supportsDeviceAuth', () => {
  it('should return true for versions >= 1.2.88-pre', () => {
    expect(supportsDeviceAuth('1.2.88-pre')).toBe(true);
    expect(supportsDeviceAuth('1.2.88')).toBe(true);
    expect(supportsDeviceAuth('1.2.89')).toBe(true);
    expect(supportsDeviceAuth('1.3.0')).toBe(true);
    expect(supportsDeviceAuth('2.0.0')).toBe(true);
  });

  it('should return false for versions < 1.2.88-pre', () => {
    expect(supportsDeviceAuth('1.2.87')).toBe(false);
    expect(supportsDeviceAuth('1.1.99')).toBe(false);
    expect(supportsDeviceAuth('1.0.0')).toBe(false);
  });

  it('should return false for null or invalid versions', () => {
    expect(supportsDeviceAuth(null)).toBe(false);
    expect(supportsDeviceAuth('invalid')).toBe(false);
  });
});

describe('deviceAuthFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should complete device authentication successfully', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          deviceCode: 'device-123',
          userCode: 'USER-123',
          verificationUri: 'https://example.com/verify',
          verificationUriComplete: 'https://example.com/verify?code=USER-123',
          expiresIn: 600,
          interval: 0.001,
        },
      })
      .mockResolvedValueOnce({ status: 200, data: { token: 'auth-token' } });

    const token = await deviceAuthFlow('https://example.com');
    expect(token).toBe('auth-token');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('should throw error when initiate request fails', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

    await expect(deviceAuthFlow('https://example.com')).rejects.toThrow(
      'Failed to initiate device authentication: Network error'
    );
  });
});
