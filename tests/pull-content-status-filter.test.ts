import { getPullTargetsFromOperations } from '../src/scripts/pull-content';

describe('pull-content status filters', () => {
  const makeLocal = (slug: string, id?: number) => ({
    slug,
    locale: 'en',
    type: 'article',
    metadata: { id },
    filePath: `/tmp/${slug}.mdx`,
    body: '',
    isLocal: true,
  });

  const makeRemote = (id: number, slug: string) => ({
    id,
    slug,
    type: 'article',
    language: 'en',
    title: slug,
    body: '# body',
    isLocal: false,
  });

  it('returns only remote-backed operations for pull and skips local-only new files', () => {
    const operations = {
      create: [{ local: makeLocal('new-local') }],
      update: [{ local: makeLocal('updated', 10), remote: makeRemote(10, 'updated') }],
      rename: [{ local: makeLocal('renamed', 11), remote: makeRemote(11, 'old-slug'), oldSlug: 'old-slug' }],
      typeChange: [{ local: makeLocal('type-changed', 12), remote: makeRemote(12, 'type-changed'), oldType: 'page', newType: 'article' }],
      conflict: [{ local: makeLocal('conflicted', 13), remote: makeRemote(13, 'conflicted'), reason: 'Remote updated' }],
      delete: [{ local: makeLocal('deleted', 14), remote: makeRemote(14, 'deleted') }],
    };

    const result = getPullTargetsFromOperations(operations as any);

    expect(result.items.map(item => item.id)).toEqual([10, 11, 12, 13, 14]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].local.slug).toBe('new-local');
  });
});
