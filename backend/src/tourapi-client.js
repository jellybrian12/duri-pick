const baseUrl = 'https://apis.data.go.kr/B551011/KorService2/'
const successCodes = new Set(['0000', '00'])
const gatewayErrorPattern =
  /\b(?:SERVICE_KEY_IS_NOT_REGISTERED_ERROR|SERVICE_ACCESS_DENIED_ERROR|PERMISSION_DENIED|SERVICE_KEY_IS_NULL|DEADLINE_HAS_EXPIRED_ERROR|LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR|LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR)\b/

export function createTourApiClient(serviceKey, fetchResponse = fetch) {
  const configuredKey = serviceKey?.trim()
  if (!configuredKey) throw new Error('TOURAPI_SERVICE_KEY is required.')

  // 포털에서 인코딩된 키를 복사한 경우에도 URLSearchParams로 한 번만 인코딩한다.
  const key = /%[\da-f]{2}/i.test(configuredKey) ? decodeURIComponent(configuredKey) : configuredKey

  return async function request(operation, parameters) {
    const url = new URL(operation, baseUrl)
    url.search = new URLSearchParams({
      ...parameters,
      serviceKey: key,
      MobileOS: 'ETC',
      MobileApp: 'DuriPick',
      _type: 'json',
    })

    let response
    let body
    try {
      response = await fetchResponse(url, { redirect: 'error', signal: AbortSignal.timeout(12_000) })
      body = await response.text()
    } catch (error) {
      // 요청 오류에 URL이 포함될 수 있으므로 키가 로그에 남지 않도록 정해진 사유만 기록한다.
      return { error: error.name === 'TimeoutError' ? 'tourapi_timeout' : 'tourapi_network_error' }
    }

    let payload
    try {
      payload = JSON.parse(body)?.response
    } catch {
      // JSON을 요청해도 게이트웨이 오류는 XML로 반환될 수 있다.
    }

    const code = String(payload?.header?.resultCode ?? '')
    if (!response.ok || !successCodes.has(code)) {
      return {
        error: body.match(gatewayErrorPattern)?.[0] ??
          (/^\d{2,6}$/.test(code) ? code : 'tourapi_unexpected_response'),
        http: response.status,
      }
    }

    const total = String(payload.body?.totalCount ?? '')
    const items = payload.body?.items?.item
    if (!/^\d+$/.test(total) || !Number.isSafeInteger(Number(total)) ||
        (Number(total) > 0 && (!items || typeof items !== 'object'))) {
      return { error: 'tourapi_unexpected_response', http: response.status }
    }

    return { total: Number(total), rows: Array.isArray(items) ? items : items ? [items] : [] }
  }
}
