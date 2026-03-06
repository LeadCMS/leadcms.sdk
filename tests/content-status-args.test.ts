import { parseContentStatusFilter, parsePushContentStatusArgs } from '../src/cli/bin/content-status-args';

describe('content status arg parsing', () => {
  it('treats bare --status as status-only for push-content', () => {
    expect(parsePushContentStatusArgs(['--status'])).toEqual({
      statusOnly: true,
      statusFilter: undefined,
    });
  });

  it('treats --status new as a filter for push-content', () => {
    expect(parsePushContentStatusArgs(['--status', 'new'])).toEqual({
      statusOnly: false,
      statusFilter: ['new'],
    });
  });

  it('supports comma-separated status filters', () => {
    expect(parsePushContentStatusArgs(['--status=new,modified'])).toEqual({
      statusOnly: false,
      statusFilter: ['new', 'modified'],
    });
  });

  it('does not treat --filter as a status alias', () => {
    expect(parseContentStatusFilter(['--filter', 'conflict,new'])).toBeUndefined();
  });
});
