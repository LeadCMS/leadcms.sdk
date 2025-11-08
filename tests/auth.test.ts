import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import {
  getLeadCMSVersion,
  compareVersions,
  supportsDeviceAuth,
  verifyToken,
  saveTokenToEnv,
  deviceAuthFlow,
  manualTokenFlow,
  authenticate,
} from '../src/lib/auth';

// Mock dependencies
jest.mock('axios');
jest.mock('fs');
jest.mock('path');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedPath = path as jest.Mocked<typeof path>;

describe('LeadCMS Authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getLeadCMSVersion', () => {
    it('should return version from API response', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { version: '1.2.88' }
      });

      const version = await getLeadCMSVersion('https://example.com');
      expect(version).toBe('1.2.88');
      expect(mockedAxios.get).toHaveBeenCalledWith('https://example.com/api/version', {
        timeout: 5000
      });
    });

    it('should return null when API call fails', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      const version = await getLeadCMSVersion('https://example.com');
      expect(version).toBeNull();
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
      expect(compareVersions('1.2.88-pre', '1.2.88')).toBe(0); // Ignores pre-release tag
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

  describe('verifyToken', () => {
    it('should return user data for valid token', async () => {
      const mockUser = {
        email: 'test@example.com',
        userName: 'testuser',
        displayName: 'Test User'
      };

      mockedAxios.get.mockResolvedValue({ data: mockUser });

      const user = await verifyToken('https://example.com', 'valid-token');
      expect(user).toEqual(mockUser);
      expect(mockedAxios.get).toHaveBeenCalledWith('https://example.com/api/users/me', {
        headers: {
          Authorization: 'Bearer valid-token'
        }
      });
    });

    it('should throw error for invalid token', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Unauthorized'));

      await expect(verifyToken('https://example.com', 'invalid-token')).rejects.toThrow('Unauthorized');
    });
  });

  describe('saveTokenToEnv', () => {
    beforeEach(() => {
      mockedPath.join.mockReturnValue('/mock/path/.env');
    });

    it('should create new .env file if it does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      saveTokenToEnv('test-token');

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        '/mock/path/.env',
        'LEADCMS_API_KEY=test-token\n',
        'utf-8'
      );
    });

    it('should update existing LEADCMS_API_KEY in .env file', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('SOME_VAR=value\nLEADCMS_API_KEY=old-token\nOTHER_VAR=other');

      saveTokenToEnv('new-token');

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        '/mock/path/.env',
        'SOME_VAR=value\nLEADCMS_API_KEY=new-token\nOTHER_VAR=other',
        'utf-8'
      );
    });

    it('should append LEADCMS_API_KEY if it does not exist in .env file', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('SOME_VAR=value\nOTHER_VAR=other');

      saveTokenToEnv('new-token');

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        '/mock/path/.env',
        'SOME_VAR=value\nOTHER_VAR=other\nLEADCMS_API_KEY=new-token\n',
        'utf-8'
      );
    });

    it('should handle empty .env file', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('');

      saveTokenToEnv('test-token');

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        '/mock/path/.env',
        'LEADCMS_API_KEY=test-token\n',
        'utf-8'
      );
    });
  });

  describe('deviceAuthFlow', () => {
    const mockInitData = {
      deviceCode: 'device-123',
      userCode: 'USER-123',
      verificationUri: 'https://example.com/verify',
      verificationUriComplete: 'https://example.com/verify?code=USER-123',
      expiresIn: 600,
      interval: 5
    };

    it('should complete device authentication successfully', async () => {
      // Use a very short interval to make the test fast
      const fastMockInitData = {
        ...mockInitData,
        interval: 0.001 // 1ms instead of 5 seconds
      };

      // Mock initiate request
      mockedAxios.post
        .mockResolvedValueOnce({ data: fastMockInitData })
        .mockResolvedValueOnce({
          status: 200,
          data: { token: 'auth-token' }
        });

      const token = await deviceAuthFlow('https://example.com');

      expect(token).toBe('auth-token');
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      expect(mockedAxios.post).toHaveBeenNthCalledWith(1,
        'https://example.com/api/identity/device/initiate',
        {},
        { headers: { 'Content-Type': 'application/json' } }
      );
    });


    it('should throw error when initiate request fails', async () => {
      jest.clearAllMocks();
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

      await expect(deviceAuthFlow('https://example.com')).rejects.toThrow(
        'Failed to initiate device authentication: Network error'
      );
    });
  });

  describe('manualTokenFlow', () => {
    it('should return token from user input', async () => {
      const mockQuestion = jest.fn().mockResolvedValue('user-input-token');

      const token = await manualTokenFlow('https://example.com', mockQuestion);

      expect(token).toBe('user-input-token');
      expect(mockQuestion).toHaveBeenCalledWith('🔑 Paste your API token here: ');
    });

    it('should throw error when no token provided', async () => {
      const mockQuestion = jest.fn().mockResolvedValue('');

      await expect(manualTokenFlow('https://example.com', mockQuestion)).rejects.toThrow('No token provided');
    });
  });

  describe('authenticate', () => {
    const mockUser = {
      email: 'test@example.com',
      userName: 'testuser',
      displayName: 'Test User'
    };

    beforeEach(() => {
      // Mock verifyToken to always succeed
      mockedAxios.get.mockResolvedValue({ data: mockUser });
    });

    it('should use device auth for supported versions', async () => {
      jest.clearAllMocks();

      // Mock version check to return supported version
      mockedAxios.get
        .mockResolvedValueOnce({ data: { version: '1.2.88' } })
        .mockResolvedValue({ data: mockUser }); // For verifyToken

      // Mock device auth flow with fast interval
      const fastMockInitData = {
        deviceCode: 'device-123',
        userCode: 'USER-123',
        verificationUri: 'https://example.com/verify',
        verificationUriComplete: 'https://example.com/verify?code=USER-123',
        expiresIn: 600,
        interval: 0.001 // Fast interval
      };

      mockedAxios.post
        .mockResolvedValueOnce({ data: fastMockInitData })
        .mockResolvedValueOnce({
          status: 200,
          data: { token: 'device-token' }
        });

      const mockQuestion = jest.fn();
      const result = await authenticate('https://example.com', mockQuestion);

      expect(result).toEqual({
        token: 'device-token',
        user: mockUser
      });
      expect(mockQuestion).not.toHaveBeenCalled();
    });

    it('should use manual auth for unsupported versions', async () => {
      // Mock version check
      mockedAxios.get
        .mockResolvedValueOnce({ data: { version: '1.2.87' } });

      const mockQuestion = jest.fn().mockResolvedValue('manual-token');
      const result = await authenticate('https://example.com', mockQuestion);

      expect(result).toEqual({
        token: 'manual-token',
        user: mockUser
      });
      expect(mockQuestion).toHaveBeenCalled();
    });

    it('should use manual auth when version check fails', async () => {
      // Mock version check failure
      mockedAxios.get
        .mockRejectedValueOnce(new Error('Version check failed'))
        .mockResolvedValueOnce({ data: mockUser }); // For verifyToken

      const mockQuestion = jest.fn().mockResolvedValue('manual-token');
      const result = await authenticate('https://example.com', mockQuestion);

      expect(result).toEqual({
        token: 'manual-token',
        user: mockUser
      });
      expect(mockQuestion).toHaveBeenCalled();
    });

    it('should verify token after obtaining it', async () => {
      // Mock version check
      mockedAxios.get
        .mockResolvedValueOnce({ data: { version: '1.0.0' } })
        .mockResolvedValueOnce({ data: mockUser });

      const mockQuestion = jest.fn().mockResolvedValue('test-token');

      await authenticate('https://example.com', mockQuestion);

      expect(mockedAxios.get).toHaveBeenCalledWith('https://example.com/api/users/me', {
        headers: { Authorization: 'Bearer test-token' }
      });
    });
  });
});
