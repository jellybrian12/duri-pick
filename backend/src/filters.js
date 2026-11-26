const settings = [
  { slug: 'indoor', name: '실내' },
  { slug: 'outdoor', name: '실외' },
  { slug: 'mixed', name: '실내·실외' },
]

export async function getFilters(prisma) {
  // 정렬 값이 같은 옵션은 ID로 순서를 정하고, 응답에 필요한 필드만 읽는다.
  const orderBy = [{ sortOrder: 'asc' }, { id: 'asc' }]
  const select = { slug: true, name: true }
  const [regions, categories, tags] = await Promise.all([
    prisma.region.findMany({ orderBy, select }),
    prisma.category.findMany({ orderBy, select }),
    prisma.tag.findMany({ orderBy, select: { ...select, kind: true } }),
  ])

  // 분위기와 상황은 같은 테이블에서 읽고, API에서 별도 선택지로 제공한다.
  const moods = []
  const situations = []
  for (const { kind, slug, name } of tags) {
    if (kind === 'mood') moods.push({ slug, name })
    if (kind === 'situation') situations.push({ slug, name })
  }

  return { regions, categories, moods, situations, settings }
}
