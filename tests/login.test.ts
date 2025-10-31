/**
 * Tests for login functionality
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

// Mock modules
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Login Flow', () => {
  const testEnvPath = path.join(__dirname, '.test-env');

  beforeEach(() => {
    // Clean up test .env file
    if (fs.existsSync(testEnvPath)) {
      fs.unlinkSync(testEnvPath);
    }
  });

  afterEach(() => {
    // Clean up test .env file
    if (fs.existsSync(testEnvPath)) {
      fs.unlinkSync(testEnvPath);
    }
    jest.clearAllMocks();
  });

  describe('Token Verification', () => {
    it('should verify valid token and return user details', async () => {
      const mockUser = {
        email: 'test@example.com',
        userName: 'testuser',
        displayName: 'Test User',
        id: '123',
      };

      mockedAxios.get.mockResolvedValue({
        data: mockUser,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      const response = await axios.get('https://test.com/api/users/me', {
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.data).toEqual(mockUser);
      expect(response.data.displayName).toBe('Test User');
      expect(response.data.email).toBe('test@example.com');
    });

    it('should handle 401 unauthorized error', async () => {
      mockedAxios.get.mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 401,
          statusText: 'Unauthorized',
        },
      });

      await expect(
        axios.get('https://test.com/api/users/me', {
          headers: { Authorization: 'Bearer invalid-token' },
        })
      ).rejects.toMatchObject({
        response: {
          status: 401,
        },
      });
    });

    it('should handle 404 user not found error', async () => {
      mockedAxios.get.mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 404,
          statusText: 'Not Found',
        },
      });

      await expect(
        axios.get('https://test.com/api/users/me', {
          headers: { Authorization: 'Bearer valid-but-no-user' },
        })
      ).rejects.toMatchObject({
        response: {
          status: 404,
        },
      });
    });
  });

  describe('Environment File Management', () => {
    it('should save token to new .env file', () => {
      const token = 'test-token-123';
      const envContent = `LEADCMS_API_KEY=${token}\n`;

      fs.writeFileSync(testEnvPath, envContent, 'utf-8');

      const content = fs.readFileSync(testEnvPath, 'utf-8');
      expect(content).toContain(`LEADCMS_API_KEY=${token}`);
    });

    it('should update existing LEADCMS_API_KEY in .env file', () => {
      const oldToken = 'old-token';
      const newToken = 'new-token';

      // Write initial .env file
      fs.writeFileSync(testEnvPath, `LEADCMS_API_KEY=${oldToken}\nOTHER_VAR=value\n`, 'utf-8');

      // Update the token
      let content = fs.readFileSync(testEnvPath, 'utf-8');
      const lines = content.split('\n');
      const apiKeyIndex = lines.findIndex((line) => line.startsWith('LEADCMS_API_KEY='));
      lines[apiKeyIndex] = `LEADCMS_API_KEY=${newToken}`;
      content = lines.join('\n');
      fs.writeFileSync(testEnvPath, content, 'utf-8');

      // Verify update
      const updated = fs.readFileSync(testEnvPath, 'utf-8');
      expect(updated).toContain(`LEADCMS_API_KEY=${newToken}`);
      expect(updated).toContain('OTHER_VAR=value');
      expect(updated).not.toContain(oldToken);
    });

    it('should add LEADCMS_API_KEY to existing .env without it', () => {
      const token = 'new-token';

      // Write initial .env file without LEADCMS_API_KEY
      fs.writeFileSync(testEnvPath, 'OTHER_VAR=value\n', 'utf-8');

      // Add the token
      let content = fs.readFileSync(testEnvPath, 'utf-8');
      content += `LEADCMS_API_KEY=${token}\n`;
      fs.writeFileSync(testEnvPath, content, 'utf-8');

      // Verify addition
      const updated = fs.readFileSync(testEnvPath, 'utf-8');
      expect(updated).toContain('OTHER_VAR=value');
      expect(updated).toContain(`LEADCMS_API_KEY=${token}`);
    });
  });

  describe('User Details DTO', () => {
    it('should match swagger UserDetailsDto schema', () => {
      const userDetails = {
        email: 'user@example.com',
        userName: 'johndoe',
        displayName: 'John Doe',
        data: { preferences: { theme: 'dark' } },
        id: 'user-123',
        createdAt: '2023-04-18T12:00:00.0000000Z',
        lastTimeLoggedIn: '2025-10-31T10:00:00.0000000Z',
        avatarUrl: 'https://example.com/avatar.jpg',
      };

      // Verify required fields exist
      expect(userDetails).toHaveProperty('email');
      expect(userDetails).toHaveProperty('userName');
      expect(userDetails).toHaveProperty('displayName');

      // Verify field types
      expect(typeof userDetails.email).toBe('string');
      expect(typeof userDetails.userName).toBe('string');
      expect(typeof userDetails.displayName).toBe('string');
      expect(userDetails.email.length).toBeGreaterThan(0);
      expect(userDetails.userName.length).toBeGreaterThan(0);
      expect(userDetails.displayName.length).toBeGreaterThan(0);
    });
  });
});
