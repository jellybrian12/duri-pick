import express from 'express'
import { getFilters } from './filters.js'
import { getPlaces, InvalidPlacesQuery, parsePlacesQuery } from './places.js'

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

const server = app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${server.address().port}`)
})
