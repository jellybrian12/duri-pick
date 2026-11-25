import { loadEnvFile } from 'node:process'
import { defineConfig } from 'prisma/config'

// Prisma CLI도 백엔드와 같은 .env를 읽는다. 파일 위치는 현재 작업 폴더와 무관하다.
try {
  loadEnvFile(new URL('./.env', import.meta.url))
} catch (error) {
  // 환경변수를 직접 주입하거나 DB 없이 클라이언트 코드를 생성하는 경우도 허용한다.
  if (error.code !== 'ENOENT') throw error
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    // 마이그레이션은 DB 구조를 만들고, 시드는 그 구조에 초기 분류 데이터를 넣는다.
    path: 'prisma/migrations',
    seed: 'node --env-file-if-exists=.env prisma/seed.js',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
})
