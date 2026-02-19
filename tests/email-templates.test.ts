import {
  parseEmailTemplateFileContent,
  transformEmailTemplateRemoteToLocalFormat,
  formatEmailTemplateForApi,
} from '../src/lib/email-template-transformation';

describe('email template HTML frontmatter', () => {
  it('parses HTML comment frontmatter and body', () => {
    const input = `<!--
---
name: "Welcome"
subject: "Hello"
fromEmail: "team@example.com"
groupName: "Notifications"
---
-->
<body>Hi</body>`;

    const parsed = parseEmailTemplateFileContent(input);
    expect(parsed.metadata.name).toBe('Welcome');
    expect(parsed.metadata.subject).toBe('Hello');
    expect(parsed.metadata.fromEmail).toBe('team@example.com');
    expect(parsed.metadata.groupName).toBe('Notifications');
    expect(parsed.body).toBe('<body>Hi</body>');
  });

  it('still parses legacy emailGroupId from frontmatter', () => {
    const input = `<!--
---
name: "Legacy"
emailGroupId: 12
---
-->
<body>Hi</body>`;

    const parsed = parseEmailTemplateFileContent(input);
    expect(parsed.metadata.emailGroupId).toBe(12);
  });

  it('serializes remote template into HTML with groupName instead of emailGroupId', () => {
    const remote = {
      id: 5,
      name: 'Reset Password',
      subject: 'Reset',
      fromEmail: 'support@example.com',
      fromName: 'Support',
      language: 'en',
      emailGroupId: 2,
      emailGroup: { id: 2, name: 'Notifications' },
      bodyTemplate: '<img src="/api/media/emails/reset.png" />',
    };

    const output = transformEmailTemplateRemoteToLocalFormat(remote);
    expect(output).toContain('<!--');
    expect(output).toContain('name: Reset Password');
    expect(output).toContain('groupName: Notifications');
    expect(output).not.toContain('emailGroupId');
    expect(output).toContain('/media/emails/reset.png');
  });

  it('does not include emailGroupId in serialized output', () => {
    const remote = {
      id: 5,
      name: 'Welcome',
      subject: 'Hello',
      emailGroupId: 3,
      bodyTemplate: '<body>Hi</body>',
    };

    const output = transformEmailTemplateRemoteToLocalFormat(remote);
    expect(output).not.toContain('emailGroupId');
  });

  it('formats local template for API with media path replacement', () => {
    const local = {
      metadata: {
        name: 'Welcome',
        subject: 'Hello',
        fromEmail: 'team@example.com',
        fromName: 'Team',
        language: 'en',
        emailGroupId: 9,
      },
      body: '<img src="/media/emails/welcome.png" />',
    };

    const payload = formatEmailTemplateForApi(local);
    expect(payload.bodyTemplate).toContain('/api/media/emails/welcome.png');
    expect(payload.emailGroupId).toBe(9);
  });

  it('does not send groupName to the API', () => {
    const local = {
      metadata: {
        name: 'Welcome',
        subject: 'Hello',
        fromEmail: 'team@example.com',
        fromName: 'Team',
        language: 'en',
        emailGroupId: 9,
        groupName: 'Notifications',
      },
      body: '<body>Hi</body>',
    };

    const payload = formatEmailTemplateForApi(local);
    expect(payload.emailGroupId).toBe(9);
    expect(payload.groupName).toBeUndefined();
  });
});
