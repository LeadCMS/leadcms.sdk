import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';

const tmpEmailTemplatesDir = path.join(os.tmpdir(), `leadcms-email-template-status-${process.pid}`);

const mockGetAllEmailTemplates = jest.fn<() => Promise<any[]>>();
const mockGetAllEmailGroups = jest.fn<() => Promise<any[]>>();

jest.mock('../src/lib/data-service.js', () => ({
    leadCMSDataService: {
        getAllEmailTemplates: mockGetAllEmailTemplates,
        getAllEmailGroups: mockGetAllEmailGroups,
        isApiKeyConfigured: jest.fn(() => true),
    },
}));

jest.mock('../src/scripts/leadcms-helpers.js', () => ({
    EMAIL_TEMPLATES_DIR: tmpEmailTemplatesDir,
    defaultLanguage: 'en',
}));

import { buildEmailTemplateStatus } from '../src/scripts/push-email-templates';

async function writeTemplateFile(relativePath: string, content: string): Promise<void> {
    const filePath = path.join(tmpEmailTemplatesDir, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
}

describe('email template status classification', () => {
    beforeEach(async () => {
        mockGetAllEmailTemplates.mockReset();
        mockGetAllEmailGroups.mockReset();
        await fs.rm(tmpEmailTemplatesDir, { recursive: true, force: true });
        await fs.mkdir(tmpEmailTemplatesDir, { recursive: true });
    });

    afterAll(async () => {
        await fs.rm(tmpEmailTemplatesDir, { recursive: true, force: true });
    });

    it('classifies templates in a missing remote group as new, not conflict', async () => {
        await writeTemplateFile(
            path.join('ru-RU', 'webinar-growth-aho', 'webinar-growth-aho-followup-1.html'),
            `<!--
---
name: webinar-growth-aho-followup-1
subject: Follow-up 1
fromEmail: team@example.com
fromName: Team
language: ru-RU
---
-->
<body>Hello</body>`
        );

        mockGetAllEmailTemplates.mockResolvedValue([]);
        mockGetAllEmailGroups.mockResolvedValue([]);

        const result = await buildEmailTemplateStatus();
        const createOps = result.operations.filter(op => op.type === 'create');
        const conflictOps = result.operations.filter(op => op.type === 'conflict');

        expect(createOps).toHaveLength(1);
        expect(conflictOps).toHaveLength(0);
        expect(createOps[0].reason).toContain("Email group 'webinar-growth-aho' will be created on push");
    });

    it('classifies templates as update when a missing remote group will be created on push', async () => {
        await writeTemplateFile(
            path.join('ru-RU', 'webinar-growth-aho', 'webinar-growth-aho-followup-1.html'),
            `<!--
---
name: webinar-growth-aho-followup-1
subject: Follow-up 1
fromEmail: team@example.com
fromName: Team
language: ru-RU
---
-->
<body>Hello</body>`
        );

        mockGetAllEmailTemplates.mockResolvedValue([
            {
                id: 10,
                name: 'webinar-growth-aho-followup-1',
                subject: 'Follow-up 1',
                fromEmail: 'team@example.com',
                fromName: 'Team',
                language: 'ru-RU',
                emailGroupId: 99,
                emailGroup: { id: 99, name: 'existing-group', language: 'ru-RU' },
                bodyTemplate: '<body>Hello</body>',
            },
        ]);
        mockGetAllEmailGroups.mockResolvedValue([
            { id: 99, name: 'existing-group', language: 'ru-RU' },
        ]);

        const result = await buildEmailTemplateStatus();
        const updateOps = result.operations.filter(op => op.type === 'update');
        const conflictOps = result.operations.filter(op => op.type === 'conflict');

        expect(updateOps).toHaveLength(1);
        expect(conflictOps).toHaveLength(0);
        expect(updateOps[0].reason).toContain("Email group 'webinar-growth-aho' will be created on push");
    });
});
