import { parseArgs } from 'node:util'
import { createTourApiClient } from './tourapi-client.js'
import { assignTourApiRegion } from './tourapi-region.js'

const provider = 'tourapi'
const districts = new Set(['110', '140', '170', '200', '440'])
const contentTypes = ['12', '14', '39']
const pageSize = 40
const stopErrors = new Set([
  'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', 'SERVICE_ACCESS_DENIED_ERROR',
  'PERMISSION_DENIED', 'SERVICE_KEY_IS_NULL', 'DEADLINE_HAS_EXPIRED_ERROR',
  'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR',
])
const categorySlugs = {
  // 검증한 최하위 분류 코드만 연결한다. 문화시설이나 음식 같은 상위 분류에는 여러 카테고리가 섞여 있다.
  cafe: ['FD050100', 'FD050200'],
  restaurant: [
    'FD010100', 'FD010200', 'FD020100', 'FD020200', 'FD020300', 'FD020400', 'FD020500',
    'FD030200', 'FD030300', 'FD030400',
  ],
  exhibition: ['VE070100', 'VE070300', 'VE070500', 'VE070600'],
  walk: [
    'NA040100', 'NA040200', 'NA040300', 'NA040400', 'NA040700',
    'VE030100', 'VE030200', 'VE030300', 'VE030400', 'VE030500', 'VE040300',
  ],
}
const categoryByCode = new Map(Object.entries(categorySlugs).flatMap(([slug, codes]) =>
  codes.map((code) => [code, slug]),
))

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function coordinates(row) {
  const latitude = text(row.mapy)
  const longitude = text(row.mapx)
  const decimal = /^-?\d+(?:\.\d+)?$/
  // 서울 주변의 넓은 범위로 좌표의 유효성을 먼저 확인한다.
  // 실제 탐색 지역 경계는 이 좌표 검사와 별도로 판단한다.
  if (!decimal.test(latitude) || !decimal.test(longitude) ||
      Number(latitude) < 37 || Number(latitude) > 38 ||
      Number(longitude) < 126 || Number(longitude) > 128) {
    return null
  }
  return { latitude: Number(latitude).toFixed(6), longitude: Number(longitude).toFixed(6) }
}

function comparable(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function matchingPlace(places, name, address) {
  const candidateName = comparable(name)
  const candidateAddress = comparable(address).replace(/^서울(?:특별시|시)/, '서울')
  return places.find((place) =>
    comparable(place.name) === candidateName ||
    comparable(place.address).replace(/^서울(?:특별시|시)/, '서울') === candidateAddress,
  )
}

async function saveCandidate(db, row, context) {
  const { district, externalId, apply, regions, categories, previewedPlaces } = context
  const where = { provider_externalId: { provider, externalId } }
  const existing = await db.placeSource.findUnique({ where, include: { place: true } })
  const name = text(row.title)
  const address = text(row.addr1)
  const point = coordinates(row)
  if (!name || !address || !point) return { status: 'held', reason: 'invalid_required_fields' }

  const currentCity = text(row.lDongRegnCd)
  const currentDistrict = text(row.lDongSignguCd)
  if ((currentCity && currentCity !== '11') || (currentDistrict && currentDistrict !== district)) {
    return { status: 'held', reason: 'district_mismatch' }
  }

  const fields = { name, address, ...point, overview: text(row.overview) || null }
  const contentTypeId = text(row.contenttypeid) || null
  const timestamp = new Date()
  if (existing) {
    if (apply) {
      const old = existing.place
      const moved = old.address !== address ||
        Number(old.latitude) !== Number(point.latitude) || Number(old.longitude) !== Number(point.longitude)
      // 주소나 좌표가 바뀌면 기존에 검증한 지도 링크를 다시 확인해야 한다.
      await db.place.update({
        where: { id: old.id },
        data: { ...fields, ...(moved && { kakaoMapUrl: null, naverMapUrl: null }) },
      })
      await db.placeSource.update({
        where,
        data: { lastSyncedAt: timestamp, ...(contentTypeId && { contentTypeId }) },
      })
    }
    return { status: 'updated', placeId: existing.placeId }
  }

  const region = assignTourApiRegion({ districtCode: district, address, addressDetail: row.addr2 })
  if (!region.regionSlug) return { status: 'held', reason: region.reason }

  const classification = text(row.lclsSystm3)
  const categorySlug = categoryByCode.get(classification)
  if (!categorySlug) return { status: 'held', reason: 'unmapped_category' }

  const regionId = regions.get(region.regionSlug)
  const categoryId = categories.get(categorySlug)
  if (!regionId || !categoryId) return { status: 'held', reason: 'missing_seed_classification' }

  // 정규화한 이름이나 주소가 다른 출처의 장소와 일치하면 운영자가 중복 여부를 검토한다.
  const existingPlaces = await db.place.findMany({ select: { id: true, name: true, address: true } })
  const duplicate = matchingPlace([...existingPlaces, ...previewedPlaces], name, address)
  const status = duplicate ? 'draft' : 'published'
  let newPlace
  if (apply) {
    newPlace = await db.place.create({
      data: {
        ...fields, status, regionId, categoryId,
        sources: { create: { provider, externalId, contentTypeId, lastSyncedAt: timestamp } },
      },
      select: { id: true },
    })
  } else {
    previewedPlaces.push({ id: null, name, address })
  }

  return {
    status,
    region: region.regionSlug,
    category: categorySlug,
    ...(newPlace && { placeId: newPlace.id }),
    ...(duplicate && { reason: 'possible_duplicate', duplicatePlaceId: duplicate.id }),
  }
}

async function recordCandidate(prisma, row, context) {
  if (!context.apply) return saveCandidate(prisma, row, context)

  // 직렬화 가능 트랜잭션으로 여러 수집 작업의 중복 검사와 저장이 엇갈리지 않게 한다.
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(
        (db) => saveCandidate(db, row, context), { isolationLevel: 'Serializable' },
      )
    } catch (error) {
      if (attempt === 3 || !['P2034', 'P2002'].includes(error.code)) throw error
    }
  }
}

function shouldStop(response) {
  return response.http === 401 || response.http === 403 || response.http === 429 ||
    stopErrors.has(response.error)
}

function detailWithList(list, detail) {
  // 상세 응답의 값을 우선 사용하고 누락된 필드는 목록 응답으로 보완한다.
  const merged = { ...list, ...Object.fromEntries(Object.entries(detail).filter(([, value]) => text(value))) }
  const detailAddress = text(detail.addr1)
  if (detailAddress && detailAddress.normalize('NFC') !== text(list.addr1).normalize('NFC')) {
    // 기본 주소가 달라졌으면 목록의 법정동이 새 주소에 속하는지 확인할 수 없다.
    merged.addr2 = text(detail.addr2)
  }
  return merged
}

export async function importTourApiDistrict({ prisma, request, district, apply = false }) {
  if (!districts.has(district)) throw new Error('A supported TourAPI district code is required.')

  const [regions, categories] = await Promise.all([
    prisma.region.findMany({ select: { slug: true, id: true } }),
    prisma.category.findMany({ select: { slug: true, id: true } }),
  ])
  const report = { mode: apply ? 'apply' : 'dry-run', district, results: [], failures: [] }
  const seen = new Set()
  const context = {
    district, apply, previewedPlaces: [],
    regions: new Map(regions.map(({ slug, id }) => [slug, id])),
    categories: new Map(categories.map(({ slug, id }) => [slug, id])),
  }

  for (const contentTypeId of contentTypes) {
    for (let page = 1; ; page++) {
      const list = await request('areaBasedList2', {
        lDongRegnCd: '11',
        lDongSignguCd: district,
        contentTypeId,
        pageNo: String(page),
        numOfRows: String(pageSize),
      })
      if (list.error || (!list.rows.length && list.total > (page - 1) * pageSize)) {
        report.failures.push({
          operation: 'areaBasedList2', contentTypeId, page,
          error: list.error ?? 'incomplete_page', http: list.http,
        })
        // 인증이 거절되거나 일일 호출 한도를 넘기면 추가 요청을 중단한다.
        if (shouldStop(list)) return report
        break
      }

      for (const row of list.rows) {
        const externalId = text(row?.contentid)
        if (!/^\d+$/.test(externalId)) {
          report.results.push({ status: 'held', reason: 'invalid_content_id', contentTypeId, page })
          continue
        }
        if (seen.has(externalId)) continue
        seen.add(externalId)
        const detail = await request('detailCommon2', { contentId: externalId, numOfRows: '1', pageNo: '1' })
        const item = detail.rows?.find((record) => text(record?.contentid) === externalId)
        if (detail.error || !item) {
          report.failures.push({
            operation: 'detailCommon2', externalId, error: detail.error ?? 'detail_missing', http: detail.http,
          })
          if (shouldStop(detail)) return report
          continue
        }

        try {
          const result = await recordCandidate(prisma, detailWithList(row, item), { ...context, externalId })
          report.results.push({ externalId, ...result })
        } catch {
          report.failures.push({ operation: 'save_candidate', externalId, error: 'database_error' })
        }
      }

      if (page * pageSize >= list.total) break
    }
  }
  return report
}

async function main() {
  const { values } = parseArgs({
    options: { district: { type: 'string' }, apply: { type: 'boolean', default: false } },
  })
  if (!districts.has(values.district)) {
    throw new Error('Use --district with one of: 110, 140, 170, 200, 440.')
  }

  const request = createTourApiClient(process.env.TOURAPI_SERVICE_KEY)
  const { createPrismaClient } = await import('./db.js')
  const prisma = createPrismaClient()
  try {
    const report = await importTourApiDistrict({ prisma, request, district: values.district, apply: values.apply })
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    if (report.failures.length > 0) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

if (import.meta.main) {
  main().catch(() => {
    // 외부 API나 DB 오류에 인증 정보가 포함될 수 있으므로 명령 실행 실패는 일반 메시지로 안내한다.
    console.error('TourAPI import failed. Check the DB connection, TOURAPI_SERVICE_KEY and --district (110, 140, 170, 200, 440).')
    process.exitCode = 1
  })
}
