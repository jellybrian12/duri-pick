# 데이트 장소 탐색 서비스 API

상태 · v0.5 검토용 초안  
관련 문서 · [PRD](PRD.md) · [DB 스키마](DB_SCHEMA.md)

## 공통 규칙

- 기본 경로는 `/api/v1`이다. 본문과 응답은 JSON이며, 문서 내 경로는 기본 경로를 생략한다.
- 장소 ID는 양의 32비트 정수다. 잘못된 형식은 `400`, 정상 형식이지만 미등록이거나 비공개인 장소는 `404`로 반환한다.
- `page` 기본값은 1, `pageSize` 기본값은 12, 최대값은 30이다. 범위를 벗어난 페이지 번호를 방지하기 위해 최대 `page`는 1,000으로 둔다. 페이지는 오프셋 방식이며, 페이지 요청 사이에 장소가 추가되거나 비공개로 바뀌면 일부 항목이 겹치거나 건너뛸 수 있다. React는 ID로 중복을 제거하고 검색어나 필터를 바꿀 때 목록을 처음부터 조회한다.
- 검색어는 앞뒤 공백을 제거하고 최대 50자로 제한한다. 빈 문자열은 전체 검색으로 처리한다. 장소명·지역명 부분 일치이며, 사용자 입력은 와일드카드가 아닌 텍스트로 처리한다. 다중 필터는 쉼표로 구분한다. 알 수 없는 필터 값, 잘못된 형식과 중복 쿼리 키는 `400`을 반환한다.
- 장소 목록과 상세는 Express가 PostgreSQL에서 읽는다. TourAPI는 가져오기 작업에서만 호출한다. 공개되지 않은 데이터와 내부 출처 검토 메모는 응답에서 제외한다. 선택 응답 값이 없으면 `null`, 결과 집합이 비어 있으면 `[]`을 사용한다.

| 메서드와 경로 | 동작 | 요구사항 |
| --- | --- | --- |
| `GET /filters` | 지역·카테고리·분위기·상황·실내외 선택지 | FR-01·03 |
| `GET /places` | 장소 목록·검색·필터 | FR-01·02·03 |
| `GET /places/:id` | 장소 상세와 외부 지도 링크 | FR-04·07 |
| `GET /places/:id/nearby` | 해당 장소 주변의 카카오 실시간 검색 | FR-05 |
| `GET /places?ids=...` | 최근 조회한 장소 카드 조회 | FR-07 |

## 필터와 목록

`GET /filters`는 `regions`, `categories`, `moods`, `situations`, `settings` 배열을 반환한다. 배열 원소는 `{ "slug": "seochon", "name": "서촌" }` 형식이다. 실내외 선택지는 `indoor`, `outdoor`, `mixed`다.

| 목록 쿼리 | 값 |
| --- | --- |
| `q` | 장소명 또는 지역명 부분 일치 |
| `region`, `category` | 등록된 지역과 카테고리 slug |
| `mood`, `situation` | 태그 종류별로 등록된 slug |
| `setting` | `indoor,outdoor,mixed`. 실내 또는 실외 필터는 `mixed`도 포함한다. 유효한 `setting` 필터가 있으면 미분류 장소는 결과에서 제외한다. |
| `page`, `pageSize` | 공통 페이지 규칙 |
| `ids` | 양의 정수 최대 20개. 입력 순서의 첫 등장대로 반환하고 미등록·비공개 장소는 생략한다. 다른 쿼리와 함께 사용하면 `400`이다. |

같은 필터 키에 있는 값은 OR, 서로 다른 필터 키는 AND로 적용한다. 일반 목록은 등록일 내림차순으로 반환하며 등록일이 같으면 ID 내림차순으로 비교한다. 목록은 `pageSize + 1`건 조회 후 추가 행의 존재로 `hasNextPage`를 계산한다.

`GET /places?region=seochon&mood=quiet,cozy&situation=rainy-day&setting=indoor&page=1`

```json
{
  "items": [
    {
      "id": 101,
      "name": "예시 찻집",
      "region": { "slug": "seochon", "name": "서촌" },
      "category": { "slug": "cafe", "name": "카페" },
      "setting": "indoor",
      "moods": [{ "slug": "quiet", "name": "조용한" }],
      "situations": [{ "slug": "rainy-day", "name": "비 오는 날" }],
      "coverImage": null
    }
  ],
  "page": 1,
  "pageSize": 12,
  "hasNextPage": false
}
```

미분류 장소의 `setting`은 `null`이며 등록한 태그가 없으면 `moods`와 `situations`는 빈 배열이다. `coverImage`가 있으면 `{ "url": "...", "alt": "...", "attributionText": null }` 형식이다. `ids` 모드는 동일한 장소 카드 배열을 `{ "items": [...] }`로 반환한다. 최근 조회 화면은 로컬 기록에 있지만 응답에서 생략된 장소를 이용 불가 상태로 표시하고 삭제할 수 있게 한다.

## 장소 상세

`GET /places/:id`는 목록 카드 필드에 아래 값을 추가한 단일 객체를 반환한다. 예시는 추가 필드다.

```json
{
  "summary": "차를 마시며 조용히 이야기하기 좋은 예시 장소",
  "overview": null,
  "source": { "provider": "tourapi", "name": "한국관광공사 TourAPI", "url": null },
  "address": "서울 종로구 예시로 1",
  "coordinates": { "latitude": 37.58, "longitude": 126.97 },
  "verifiedAt": "2026-11-19T00:00:00Z",
  "images": [],
  "mapLinks": { "kakao": "https://map.kakao.com/link/map/101%20%EC%98%88%EC%8B%9C,37.58,126.97", "naver": null }
}
```

`summary`는 운영자 한줄 소개, `overview`는 가져온 TourAPI 소개이며 둘 다 비어 있으면 `null`이다. `verifiedAt`은 운영 정보 별도 확인일로 미확인 상태에서는 `null`이다. `source.url`은 확인 가능한 원본 페이지가 있을 때만 제공한다. 지도에는 검증 링크 또는 이름·좌표로 만든 카카오맵 위치 링크를 사용한다. TourAPI ID는 카카오 장소 ID로 사용하지 않는다. `images`는 대표 사진과 같은 형식으로 정렬해 제공한다. 클라이언트는 상세 렌더링에 성공했을 때 최근 조회를 등록한다.

## TourAPI 가져오기

이 작업은 서버에서 운영용으로 실행한다. 브라우저는 기존 `/places`와 `/places/:id`를 사용한다. `KorService2`의 `areaBasedList2`로 후보를 찾고 `detailCommon2`로 공통 상세를 보강한다. 필요할 때 `detailIntro2`와 `detailImage2`를 사용한다. 인증키는 서버 환경변수로 설정한다. [공공데이터포털 명세](https://www.data.go.kr/data/15101578/openapi.do)

TourAPI `contentid`는 내부 장소 ID와 연결한다. 가져오기 작업은 `mapX`를 경도, `mapY`를 위도로 해석하고 누락·범위 오류를 검증한다. 신규 후보가 자동 검사를 통과하면 수집 작업에서 공개한다. 보류 후보는 목록 응답에 포함하지 않으며 해당 ID로 상세를 요청하면 `404 PLACE_NOT_FOUND`를 반환한다. TourAPI 타임아웃·쿼터 초과가 나면 실패한 수집 범위를 기록하고 기존 공개 데이터는 그대로 조회한다. 아직 공개 데이터가 없는 환경에서는 유효한 목록 요청에 빈 결과를 반환한다.

## 주변 장소 검색

`GET /places/101/nearby?category=cafe`는 상세 장소 ID로 PostgreSQL에서 중심 좌표를 조회하고 카카오 카테고리 검색을 호출한다. 클라이언트는 장소 ID와 카테고리를 보내며 위치 권한 요청은 필요 없다. `category`는 `cafe` 기본값 또는 `restaurant`다. 서버가 각각 `CE7`, `FD6`으로 매핑하며, 경도는 `x`, 위도는 `y`, 반경은 1,000m로 요청한다. 거리순 첫 페이지를 최대 10개 요청하고, 중심과 이름·주소가 일치하는 결과는 제외한다.

```json
{
  "source": "kakao",
  "radiusMeters": 1000,
  "items": [
    {
      "providerPlaceId": "123456",
      "name": "주변 카페 예시",
      "address": "서울 종로구 예시로 3",
      "distanceMeters": 140,
      "mapUrl": "https://place.map.kakao.com/123456"
    }
  ]
}
```

REST API 키는 Express의 환경변수에 두고 브라우저에는 전달하지 않는다. 요청 시간 제한은 초안 기준 3초이며, 설정으로 조절한다. 서버는 거리·주소를 정규화하고 유효한 카카오맵 링크만 전달한다. 성공한 빈 결과는 `200`과 빈 배열이다. 예상치 못한 외부 응답, 시간 초과, 외부 쿼터 소진은 각각 오류 코드로 구분한다. 초기에는 사용자가 열었을 때만 호출하고 게시 전에 쿼터와 예상 호출량을 비교한다. [카카오맵 REST API 문서](https://developers.kakao.com/docs/ko/kakaomap/rest-api) · [쿼터 안내](https://developers.kakao.com/docs/ko/getting-started/quota)

## 오류 응답

```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "지원하는 필터 값을 입력해 주세요."
  }
}
```

| 상태 | 코드 | 클라이언트 처리 |
| --- | --- | --- |
| 400 | `INVALID_QUERY`, `INVALID_PLACE_ID` | 잘못된 검색 조건을 안내하거나 기본값으로 되돌린다. |
| 404 | `PLACE_NOT_FOUND` | 장소를 이용할 수 없다고 안내한다. |
| 429 | `RATE_LIMITED` | 반복 호출을 멈추고 이후 재시도를 안내한다. |
| 500 | `INTERNAL_ERROR` | 일반 오류로 안내한다. |
| 502 | `NEARBY_PROVIDER_ERROR` | 주변 검색 영역의 실패 상태로 표시한다. |
| 503 | `NEARBY_PROVIDER_QUOTA` | 주변 검색을 잠시 이용할 수 없다고 안내한다. |
| 504 | `NEARBY_PROVIDER_TIMEOUT` | 주변 검색 영역에서 재시도를 제공한다. |
