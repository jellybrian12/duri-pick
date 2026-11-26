import express from 'express'
import { getFilters } from './filters.js'

const app = express()
const host = '127.0.0.1'
const port = Number(process.env.PORT ?? 3001)

app.get('/api/v1/health', (_request, response) => {
  response.json({ status: 'ok' })
})

let prisma
app.get('/api/v1/filters', async (_request, response) => {
  try {
    // 필터를 처음 요청할 때 DB를 연결해 헬스 체크는 DB 없이도 응답할 수 있게 한다.
    if (!prisma) {
      const { createPrismaClient } = await import('./db.js')
      prisma ??= createPrismaClient()
    }
    response.json(await getFilters(prisma))
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

const server = app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${server.address().port}`)
})
