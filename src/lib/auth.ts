/**
 * LeadCMS Authentication Library
 * Shared authentication functions for device auth and manual token flows
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface UserDetailsDto {
  email: string;
  userName: string;
  displayName: string;
  data?: Record<string, any> | null;
  id?: string;
  createdAt?: string;
  lastTimeLoggedIn?: string | null;
  avatarUrl?: string;
}

interface VersionResponse {
  version: string;
  ip?: string;
  iPv4?: string;
  iPv6?: string;
  headers?: Array<{ key: string; value: string[] }>;
}

interface DeviceAuthInitiateDto {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

interface JWTokenDto {
  token: string;
  expiration: string;
}

interface DeviceAuthErrorDto {
  status?: string;
  message?: string;
  error?: string;
  error_description?: string;
}

export interface AuthResult {
  token: string;
  user: UserDetailsDto;
}

/**
 * Get LeadCMS version from /api/version endpoint
 */
export async function getLeadCMSVersion(url: string): Promise<string | null> {
  try {
    const response = await axios.get<VersionResponse>(`${url}/api/version`, {
      timeout: 5000,
    });
    return response.data.version;
  } catch (error) {
    // If version endpoint is not available, return null
    return null;
  }
}

/**
 * Compare version strings (supports semver with pre-release tags)
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export function compareVersions(v1: string, v2: string): number {
  // Extract version numbers (ignore pre-release tags and git hashes)
  const extractVersion = (v: string): number[] => {
    const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return [0, 0, 0];
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  };

  const parts1 = extractVersion(v1);
  const parts2 = extractVersion(v2);

  for (let i = 0; i < 3; i++) {
    if (parts1[i] > parts2[i]) return 1;
    if (parts1[i] < parts2[i]) return -1;
  }

  return 0;
}

/**
 * Check if device authentication is supported (version >= 1.2.88-pre)
 */
export function supportsDeviceAuth(version: string | null): boolean {
  if (!version) return false;
  return compareVersions(version, '1.2.88-pre') >= 0;
}

/**
 * Verify API token by calling /api/users/me
 */
export async function verifyToken(url: string, token: string): Promise<UserDetailsDto> {
  const response = await axios.get<UserDetailsDto>(`${url}/api/users/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return response.data;
}

/**
 * Save API token to .env file
 */
export function saveTokenToEnv(token: string): void {
  const envPath = path.join(process.cwd(), '.env');
  let envContent = '';

  // Read existing .env file if it exists
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }

  // Check if LEADCMS_API_KEY already exists
  const lines = envContent.split('\n');
  const apiKeyIndex = lines.findIndex((line) => line.startsWith('LEADCMS_API_KEY='));

  if (apiKeyIndex !== -1) {
    // Update existing key
    lines[apiKeyIndex] = `LEADCMS_API_KEY=${token}`;
    envContent = lines.join('\n');
  } else {
    // Add new key
    if (envContent && !envContent.endsWith('\n')) {
      envContent += '\n';
    }
    envContent += `LEADCMS_API_KEY=${token}\n`;
  }

  fs.writeFileSync(envPath, envContent, 'utf-8');
}

/**
 * Device authentication flow
 */
export async function deviceAuthFlow(url: string): Promise<string> {
  console.log('\n🔐 Starting device authentication...\n');

  // Step 1: Initiate device authentication
  let initData: DeviceAuthInitiateDto;
  try {
    const response = await axios.post<DeviceAuthInitiateDto>(
      `${url}/api/identity/device/initiate`,
      {},
      { headers: { 'Content-Type': 'application/json' } }
    );
    initData = response.data;
  } catch (error: any) {
    throw new Error(`Failed to initiate device authentication: ${error.message}`);
  }

  // Step 2: Display instructions to user
  console.log('📋 To complete authentication, open this link in your browser:\n');
  console.log(`   ${initData.verificationUriComplete}\n`);
  console.log(`⏱️  Code expires in ${Math.floor(initData.expiresIn / 60)} minutes`);
  console.log('⏳ Waiting for authorization...\n');

  // Step 3: Poll for completion
  const pollRequest = { deviceCode: initData.deviceCode };
  const startTime = Date.now();
  const expirationTime = startTime + initData.expiresIn * 1000;

  while (Date.now() < expirationTime) {
    await new Promise((resolve) => setTimeout(resolve, initData.interval * 1000));

    try {
      const pollResponse = await axios.post<JWTokenDto>(
        `${url}/api/identity/device/poll`,
        pollRequest,
        { headers: { 'Content-Type': 'application/json' } }
      );

      if (pollResponse.status === 200) {
        // Authentication successful
        return pollResponse.data.token;
      }
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 202) {
          // Still pending, continue polling
          continue;
        } else if (error.response?.status === 400) {
          // Device code expired, denied, or invalid
          const errorData = error.response.data as DeviceAuthErrorDto;
          throw new Error(
            errorData.error_description || errorData.message || 'Device authentication failed'
          );
        } else {
          // Other error
          throw new Error(
            `Authentication failed: ${error.response?.statusText || error.message}`
          );
        }
      } else {
        throw error;
      }
    }
  }

  throw new Error('Authentication timeout: Code expired');
}

/**
 * Manual token input flow (legacy)
 * Requires a question function for readline compatibility
 */
export async function manualTokenFlow(
  url: string,
  question: (prompt: string) => Promise<string>
): Promise<string> {
  console.log('\n🔐 LeadCMS Authentication\n');
  console.log('⚠️  Note: This instance does not support automatic device authentication.');
  console.log('   (Device authentication requires LeadCMS version 1.2.88 or higher)');
  console.log('   Please follow these steps to obtain your API token:\n');

  console.log('📋 Steps to get your API token:\n');
  console.log(`   1. Open your browser and navigate to: ${url}`);
  console.log('   2. Open Developer Tools (press F12 or right-click → Inspect)');
  console.log('   3. Go to the "Network" tab in Developer Tools');
  console.log('   4. Log in to your LeadCMS account');
  console.log('   5. After successful login, look for an API call in the Network tab');
  console.log('      → Look for "/api/users/me" request');
  console.log('   6. Click on that request');
  console.log('   7. Find the "Request Headers" section');
  console.log('   8. Locate the "Authorization" header');
  console.log('   9. Copy the token value (without the "Bearer " prefix)\n');

  // Prompt for token
  const token = await question('🔑 Paste your API token here: ');

  if (!token) {
    throw new Error('No token provided');
  }

  return token;
}

/**
 * Complete authentication flow with version detection
 * Automatically chooses between device auth and manual flow
 */
export async function authenticate(
  url: string,
  question: (prompt: string) => Promise<string>
): Promise<AuthResult> {
  // Check LeadCMS version to determine authentication method
  console.log('🔍 Checking LeadCMS version...');
  const version = await getLeadCMSVersion(url);

  let token: string;

  if (version) {
    console.log(`   Version: ${version}`);

    if (supportsDeviceAuth(version)) {
      // Use device authentication flow
      token = await deviceAuthFlow(url);
    } else {
      // Use manual token flow
      console.log('   Device authentication not supported in this version.\n');
      token = await manualTokenFlow(url, question);
    }
  } else {
    // Version check failed, use manual flow
    console.log('   Could not determine version, using manual authentication.\n');
    token = await manualTokenFlow(url, question);
  }

  // Verify token
  console.log('\n⏳ Verifying token...');
  const user = await verifyToken(url, token);

  return { token, user };
}
