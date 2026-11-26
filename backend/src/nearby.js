const categoryCodes = new Map([['cafe', 'CE7'], ['restaurant', 'FD6']])
const radiusMeters = 1000
const resultLimit = 10
const providerErrors = {
  NEARBY_PROVIDER_ERROR: { status: 502, message: '주변 장소를 불러오지 못했습니다.' },
  NEARBY_PROVIDER_QUOTA: { status: 503, message: '주변 장소 검색 한도를 초과했습니다.' },
  NEARBY_PROVIDER_TIMEOUT: { status: 504, message: '주변 장소 검색 요청 시간이 초과됐습니다.' },
}

export class NearbyProviderError extends Error {
  constructor(code) {
    const { status, message } = providerErrors[code]
    super(message)
    this.code = code
    this.status = status
  }
}

export function parseNearbyCategory(query) {
  const keys = Object.keys(query)
  if (keys.length === 0) return 'cafe'
  if (keys.length !== 1 || keys[0] !== 'category' || !categoryCodes.has(query.category)) return null
  return query.category
}

function text(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function comparableName(value) {
  return text(value).normalize('NFC').replace(/\s+/g, '').toLowerCase()
}

function comparableAddress(value) {
  // TourAPI 주소의 괄호 속 법정동과 서울 표기 차이를 정리해 카카오 주소와 비교한다.
  return text(value).normalize('NFC')
    .replace(/^서울(?:특별시|시)(?=\s)/, '서울')
    .replace(/\s*\([^()]*\)$/, '')
}

function placeMapUrl(value, providerPlaceId) {
  try {
    const url = new URL(text(value))
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'place.map.kakao.com' ||
        url.username || url.password || url.port || url.pathname.replace(/\/$/, '') !== '/' + providerPlaceId) {
      return null
    }
    return 'https://place.map.kakao.com/' + providerPlaceId
  } catch {
    return null
  }
}

function normalizePlace(row) {
  const providerPlaceId = text(row?.id)
  const name = text(row?.place_name)
  const roadAddress = text(row?.road_address_name)
  const lotAddress = text(row?.address_name)
  const distance = text(row?.distance)
  if (!/^\d+$/.test(providerPlaceId) || !name || !(roadAddress || lotAddress) || !/^\d+$/.test(distance)) {
    return null
  }

  const distanceMeters = Number(distance)
  const mapUrl = placeMapUrl(row.place_url, providerPlaceId)
  if (distanceMeters > radiusMeters || !mapUrl) return null

  return {
    item: { providerPlaceId, name, address: roadAddress || lotAddress, distanceMeters, mapUrl },
    addresses: [roadAddress, lotAddress],
  }
}

async function fetchKakaoPlaces(center, categoryCode) {
  const key = process.env.KAKAO_REST_API_KEY?.trim()
  const timeoutMs = Number(process.env.KAKAO_NEARBY_TIMEOUT_MS?.trim() || 3000)
  if (!key || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new Error('Kakao Local API settings are missing or invalid.')
  }

  const url = new URL('https://dapi.kakao.com/v2/local/search/category.json')
  // 중심 좌표는 DB의 공개 장소에서 가져온다. 카카오는 경도를 x, 위도를 y로 받는다.
  url.search = new URLSearchParams({
    category_group_code: categoryCode,
    x: String(center.longitude),
    y: String(center.latitude),
    radius: String(radiusMeters),
    sort: 'distance',
    page: '1',
    size: String(resultLimit),
  })

  const signal = AbortSignal.timeout(timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { Authorization: 'KakaoAK ' + key },
      redirect: 'error',
      signal,
    })
    if (response.status === 429) throw new NearbyProviderError('NEARBY_PROVIDER_QUOTA')

    const payload = await response.json()
    // 카카오맵은 무료 쿼터와 유료 한도 초과를 HTTP 400의 별도 코드로도 전달한다.
    if (payload?.code === -10 || payload?.code === -11) {
      throw new NearbyProviderError('NEARBY_PROVIDER_QUOTA')
    }
    if (!response.ok || !Array.isArray(payload?.documents)) {
      throw new NearbyProviderError('NEARBY_PROVIDER_ERROR')
    }
    return payload.documents
  } catch (error) {
    if (signal.aborted || error.name === 'TimeoutError') {
      throw new NearbyProviderError('NEARBY_PROVIDER_TIMEOUT')
    }
    if (error instanceof NearbyProviderError) throw error
    // 카카오 응답 본문이나 네트워크 예외를 그대로 전달하지 않아 인증 정보를 보호한다.
    throw new NearbyProviderError('NEARBY_PROVIDER_ERROR')
  }
}

export async function getNearbyPlaces(prisma, id, category) {
  const center = await prisma.place.findUnique({
    where: { id, status: 'published' },
    select: { name: true, address: true, latitude: true, longitude: true },
  })
  if (!center) return null

  const documents = await fetchKakaoPlaces(center, categoryCodes.get(category))
  const candidates = documents.map(normalizePlace).filter(Boolean)
  if (documents.length > 0 && candidates.length === 0) {
    throw new NearbyProviderError('NEARBY_PROVIDER_ERROR')
  }

  const centerName = comparableName(center.name)
  const centerAddress = comparableAddress(center.address)
  const items = candidates
    .filter(({ item, addresses }) =>
      comparableName(item.name) !== centerName || !addresses.some(address => comparableAddress(address) === centerAddress),
    )
    .map(({ item }) => item)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, resultLimit)

  return { source: 'kakao', radiusMeters, items }
}
