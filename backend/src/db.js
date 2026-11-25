import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client.ts'

export function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    // 접속 정보가 빠지면 PostgreSQL 드라이버의 기본값을 쓰기 전에 설정 오류를 알려준다.
    throw new Error('Set DATABASE_URL before connecting to PostgreSQL.')
  }

  // Prisma Client가 모델 기반 쿼리를 만들고, PrismaPg 어댑터가 pg를 통해 PostgreSQL에 전달한다.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}
