import { placeSettings } from './filters.js'

const filterKeys = ['region', 'category', 'mood', 'situation', 'setting']
const allowedKeys = new Set(['q', 'page', 'pageSize', ...filterKeys])
const settingSlugs = new Set(placeSettings.map(({ slug }) => slug))

export class InvalidPlacesQuery extends Error {}

function paginationValue(value, fallback, max) {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!/^\d+$/.test(value) || number < 1 || number > max) {
    throw new InvalidPlacesQuery('페이지 번호 또는 페이지 크기가 허용 범위를 벗어났습니다.')
  }
  return number
}

export function parsePlacesQuery(query) {
  for (const [key, value] of Object.entries(query)) {
    if (!allowedKeys.has(key) || typeof value !== 'string' || value.includes('\u0000')) {
      // 중복 쿼리 키는 Express에서 배열이 되므로 문자열이 아닌 값과 함께 거절한다.
      throw new InvalidPlacesQuery('지원하는 쿼리 키를 각각 한 번씩 사용해 주세요.')
    }
  }

  const q = query.q?.trim() ?? ''
  if ([...q].length > 50) {
    throw new InvalidPlacesQuery('검색어는 50자 이하여야 합니다.')
  }

  const filters = {}
  for (const key of filterKeys) {
    if (query[key] === undefined) continue
    const values = query[key].split(',').map(value => value.trim())
    if (values.includes('')) {
      throw new InvalidPlacesQuery('필터 값은 빈 항목 없이 쉼표로 구분해 주세요.')
    }
    filters[key] = [...new Set(values)]
  }

  if (filters.setting?.some(slug => !settingSlugs.has(slug))) {
    throw new InvalidPlacesQuery('지원하는 실내외 필터 값을 입력해 주세요.')
  }

  return {
    q,
    filters,
    page: paginationValue(query.page, 1, 1000),
    pageSize: paginationValue(query.pageSize, 12, 30),
  }
}

async function validateFilterSlugs(prisma, filters) {
  const checks = []
  if (filters.region) {
    checks.push([filters.region, prisma.region.count({ where: { slug: { in: filters.region } } })])
  }
  if (filters.category) {
    checks.push([filters.category, prisma.category.count({ where: { slug: { in: filters.category } } })])
  }
  for (const kind of ['mood', 'situation']) {
    const slugs = filters[kind]
    if (slugs) checks.push([slugs, prisma.tag.count({ where: { kind, slug: { in: slugs } } })])
  }

  // 등록된 분류에 해당하는 장소가 없으면 유효한 빈 목록이다.
  const matches = await Promise.all(checks.map(async ([slugs, count]) => slugs.length === await count))
  if (matches.includes(false)) {
    throw new InvalidPlacesQuery('지원하는 필터 값을 입력해 주세요.')
  }
}

function placeWhere(q, filters) {
  const where = { status: 'published' }
  if (q) {
    // PostgreSQL LIKE의 와일드카드와 이스케이프 문자를 검색어의 문자 그대로 취급한다.
    const search = { contains: q.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' }
    where.OR = [{ name: search }, { region: { name: search } }]
  }

  if (filters.region) where.region = { slug: { in: filters.region } }
  if (filters.category) where.category = { slug: { in: filters.category } }
  if (filters.setting) {
    const settings = new Set(filters.setting)
    if (settings.has('indoor') || settings.has('outdoor')) settings.add('mixed')
    where.setting = { in: [...settings] }
  }

  // 분위기와 상황은 서로 다른 태그 행이므로 두 존재 조건을 각각 만족해야 한다.
  const tagFilters = ['mood', 'situation'].flatMap(kind => {
    const slugs = filters[kind]
    return slugs ? [{ tags: { some: { tag: { kind, slug: { in: slugs } } } } }] : []
  })
  if (tagFilters.length) where.AND = tagFilters
  return where
}

const orderedImages = {
  // 출처와 이용 근거를 확인한 사진만 선택한다. 제한 유형은 대표 사진보다 먼저 걸러낸다.
  where: {
    attributionText: { not: '' },
    usageBasis: { not: '' },
    AND: [
      { OR: [{ licenseCode: null }, { licenseCode: { notIn: ['Type2', 'Type3', 'Type4'] } }] },
      { OR: [
        { provider: null },
        { provider: { not: 'tourapi' } },
        { licenseCode: 'Type1', sourceUrl: { not: '' } },
      ] },
    ],
  },
  orderBy: { sortOrder: 'asc' },
  select: { imageUrl: true, altText: true, attributionText: true },
}

// 목록과 상세가 같은 카드 필드를 조회하고, 사진은 필요한 개수만 읽는다.
const placeCardSelect = {
  id: true,
  name: true,
  region: { select: { slug: true, name: true } },
  category: { select: { slug: true, name: true } },
  setting: true,
  tags: {
    orderBy: [{ tag: { sortOrder: 'asc' } }, { tagId: 'asc' }],
    select: { tag: { select: { kind: true, slug: true, name: true } } },
  },
  images: { ...orderedImages, take: 1 },
}

function placeImage({ imageUrl, altText, attributionText }) {
  return { url: imageUrl, alt: altText, attributionText }
}

function placeCard({ id, name, region, category, setting, tags, images }) {
  const moods = []
  const situations = []
  for (const { tag: { kind, slug, name: tagName } } of tags) {
    if (kind === 'mood') moods.push({ slug, name: tagName })
    if (kind === 'situation') situations.push({ slug, name: tagName })
  }
  const image = images[0]
  return {
    id,
    name,
    region,
    category,
    setting,
    moods,
    situations,
    coverImage: image ? placeImage(image) : null,
  }
}

export async function getPlaces(prisma, { q, filters, page, pageSize }) {
  await validateFilterSlugs(prisma, filters)
  const rows = await prisma.place.findMany({
    where: placeWhere(q, filters),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    // 한 건을 더 읽어 전체 건수를 별도로 세지 않고 다음 페이지 여부를 판단한다.
    take: pageSize + 1,
    select: placeCardSelect,
  })

  return {
    items: rows.slice(0, pageSize).map(placeCard),
    page,
    pageSize,
    hasNextPage: rows.length > pageSize,
  }
}

export function parsePlaceId(value) {
  // Prisma Int의 양의 정수 범위만 허용한다. 숫자 변환 전에 정수 표기를 확인한다.
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return id >= 1 && id <= 2_147_483_647 ? id : null
}

export async function getPlaceDetail(prisma, id) {
  const place = await prisma.place.findUnique({
    where: { id, status: 'published' },
    select: {
      ...placeCardSelect,
      summary: true,
      overview: true,
      address: true,
      latitude: true,
      longitude: true,
      verifiedAt: true,
      kakaoMapUrl: true,
      naverMapUrl: true,
      images: orderedImages,
      sources: {
        where: { provider: 'tourapi' },
        select: { provider: true, sourceUrl: true },
      },
    },
  })
  if (!place) return null

  const latitude = Number(place.latitude)
  const longitude = Number(place.longitude)
  const source = place.sources[0]
  // 카카오 장소 ID 대신 이름과 위도·경도로 위치 링크를 만든다.
  const kakaoLocationUrl = 'https://map.kakao.com/link/map/' +
    encodeURIComponent(place.name) + ',' + latitude + ',' + longitude

  return {
    ...placeCard(place),
    summary: place.summary,
    overview: place.overview,
    source: source ? { provider: source.provider, name: '한국관광공사 TourAPI', url: source.sourceUrl } : null,
    address: place.address,
    coordinates: { latitude, longitude },
    verifiedAt: place.verifiedAt?.toISOString() ?? null,
    images: place.images.map(placeImage),
    mapLinks: { kakao: place.kakaoMapUrl ?? kakaoLocationUrl, naver: place.naverMapUrl },
  }
}
