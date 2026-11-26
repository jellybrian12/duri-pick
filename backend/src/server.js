import express from 'express'
import { getFilters } from './filters.js'
import { getNearbyPlaces, NearbyProviderError, parseNearbyCategory } from './nearby.js'
import { getPlaceDetail, getPlaces, InvalidPlacesQuery, parsePlaceId, parsePlacesQuery } from './places.js'

const app = express()
const host = '127.0.0.1'
const port = Number(process.env.PORT ?? 3001)

app.get('/api/v1/health', (_request, response) => {
  response.json({ status: 'ok' })
})

let prisma
async function getPrisma() {
  // DB가 필요한 첫 요청에서 연결해 헬스 체크는 DB 없이도 응답할 수 있게 한다.
  if (!prisma) {
    const { createPrismaClient } = await import('./db.js')
    prisma ??= createPrismaClient()
  }
  return prisma
}

app.get('/api/v1/filters', async (_request, response) => {
  try {
    response.json(await getFilters(await getPrisma()))
  } catch {
    // DB 오류에 연결 정보가 포함될 수 있으므로 공통 오류 형식으로 응답한다.
    response.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: '필터 옵션을 불러오지 못했습니다.',
      },
    })
  }
})

app.get('/api/v1/places', async (request, response) => {
  try {
    const query = parsePlacesQuery(request.query)
    response.json(await getPlaces(await getPrisma(), query))
  } catch (error) {
    if (error instanceof InvalidPlacesQuery) {
      response.status(400).json({ error: { code: 'INVALID_QUERY', message: error.message } })
      return
    }
    response.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: '장소 목록을 불러오지 못했습니다.',
      },
    })
  }
})

function invalidPlaceId(response) {
  response.status(400).json({
    error: { code: 'INVALID_PLACE_ID', message: '유효한 장소 ID를 입력해 주세요.' },
  })
}

app.get('/api/v1/places/:id', async (request, response) => {
  const id = parsePlaceId(request.params.id)
  if (id === null) {
    invalidPlaceId(response)
    return
  }

  try {
    const detail = await getPlaceDetail(await getPrisma(), id)
    if (!detail) {
      placeNotFound(response)
      return
    }

    response.json(detail)
  } catch {
    response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '장소 상세 정보를 불러오지 못했습니다.' },
    })
  }
})

function placeNotFound(response) {
  response.status(404).json({
    error: { code: 'PLACE_NOT_FOUND', message: '장소를 이용할 수 없습니다.' },
  })
}

app.get('/api/v1/places/:id/nearby', async (request, response) => {
  const id = parsePlaceId(request.params.id)
  if (id === null) {
    invalidPlaceId(response)
    return
  }

  const category = parseNearbyCategory(request.query)
  if (!category) {
    response.status(400).json({
      error: { code: 'INVALID_QUERY', message: '주변 장소 카테고리는 cafe 또는 restaurant를 사용해 주세요.' },
    })
    return
  }

  try {
    const result = await getNearbyPlaces(await getPrisma(), id, category)
    if (!result) {
      placeNotFound(response)
      return
    }
    response.json(result)
  } catch (error) {
    if (error instanceof NearbyProviderError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message } })
      return
    }
    response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '주변 장소 검색을 준비하지 못했습니다.' },
    })
  }
})

app.use((error, request, response, next) => {
  // 잘못 인코딩된 ID는 Express가 라우트에 진입하기 전에 거절하므로 같은 JSON 오류로 응답한다.
  if (error instanceof URIError && /^\/api\/v1\/places\/[^/]+(?:\/nearby)?\/?$/i.test(request.path)) {
    invalidPlaceId(response)
    return
  }
  next(error)
})

const server = app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${server.address().port}`)
})
