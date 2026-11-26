// TourAPI 법정동 시군구 코드로 후보를 먼저 좁힌다. 같은 종로구라도
// 서촌·북촌·종로~을지로에는 서로 다른 법정동을 사용한다.
const districts = {
  110: {
    name: '종로구',
    regions: {
      seochon: ['통인동', '누상동', '누하동', '옥인동', '체부동', '필운동'],
      bukchon: ['가회동', '계동', '원서동', '삼청동', '재동'],
      'jongno-euljiro': [
        '익선동', '낙원동', '돈의동', '관수동', '관철동',
        '종로1가', '종로2가', '종로3가', '종로4가',
      ],
    },
  },
  140: {
    name: '중구',
    regions: {
      'jongno-euljiro': [
        '을지로1가', '을지로2가', '을지로3가', '을지로4가',
        '수표동', '입정동', '산림동', '주교동',
      ],
    },
  },
  170: {
    name: '용산구',
    regions: {
      yongsan: ['한강로1가', '한강로2가', '한강로3가', '이촌동', '용산동2가'],
    },
  },
  200: {
    name: '성동구',
    regions: {
      'seongsu-seoul-forest': ['성수동1가', '성수동2가'],
    },
  },
  440: {
    name: '마포구',
    regions: {
      yeonnam: ['연남동'],
    },
  },
}

const seoulAddressPattern = /^(?:서울특별시|서울시|서울)\s+(\S+구)(?:\s+|$)/

function addressText(value) {
  return typeof value === 'string' ? value.normalize('NFC').trim() : ''
}

function neighborhoodTokens(address) {
  const tokens = new Set()
  // 지번 주소의 첫 항목 또는 도로명 주소의 괄호 속 법정동을 읽는다.
  // 도로명과 건물명에 들어 있는 비슷한 문자열로 지역을 배정하지 않는다.
  const firstToken = address.split(/[\s,()]/, 1)[0]
  if (firstToken) tokens.add(firstToken)

  for (const [, parenthetical] of address.matchAll(/\(([^()]*)\)/g)) {
    for (const part of parenthetical.split(',')) {
      const token = part.trim().split(/\s+/, 1)[0]
      if (token) tokens.add(token)
    }
  }

  return tokens
}

/**
 * TourAPI 목록 요청의 lDongSignguCd와 장소의 addr1·addr2를 받아 탐색 지역을 판정한다.
 * 지역 배정에 실패한 후보는 반환된 reason으로 수집 결과에 보류 사유를 남길 수 있다.
 * 좌표와 나머지 공개 조건은 수집 단계에서 별도로 검사한다.
 */
export function assignTourApiRegion({ districtCode, address, addressDetail }) {
  const code = String(districtCode ?? '').trim()
  if (!Object.hasOwn(districts, code)) {
    return { regionSlug: null, reason: 'unsupported_district' }
  }

  const district = districts[code]
  const mainAddress = addressText(address)
  const addressPrefix = mainAddress.match(seoulAddressPattern)
  if (!addressPrefix || mainAddress.length === addressPrefix[0].length) {
    return { regionSlug: null, reason: 'unrecognized_address' }
  }

  const detail = addressText(addressDetail)
  const detailPrefix = detail.match(seoulAddressPattern)
  if (addressPrefix[1] !== district.name || (detailPrefix && detailPrefix[1] !== district.name)) {
    return { regionSlug: null, reason: 'district_mismatch' }
  }

  const tokens = neighborhoodTokens(mainAddress.slice(addressPrefix[0].length))
  for (const token of neighborhoodTokens(detail.slice(detailPrefix?.[0].length ?? 0))) {
    tokens.add(token)
  }

  const matches = Object.entries(district.regions).filter(([, neighborhoods]) =>
    neighborhoods.some((neighborhood) => tokens.has(neighborhood)),
  )
  if (matches.length === 0) {
    return { regionSlug: null, reason: 'unmapped_neighborhood' }
  }
  if (matches.length > 1) {
    return { regionSlug: null, reason: 'ambiguous_region' }
  }

  return { regionSlug: matches[0][0], reason: null }
}
