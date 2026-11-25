import { createPrismaClient } from '../src/db.js'

// 각 쌍의 첫 값은 URL과 필터에서 쓰는 고정 slug, 두 번째 값은 화면에 보여 주는 이름이다.
// 아래 배열의 순서가 sortOrder가 된다. 태그는 분위기와 상황별로 순서를 매긴다.
const regions = [
  ['yongsan', '용산'],
  ['seongsu-seoul-forest', '성수~서울숲'],
  ['yeonnam', '연남'],
  ['ikseon-dong', '익선동'],
  ['haebangchon', '해방촌'],
  ['seochon', '서촌'],
  ['bukchon', '북촌'],
]

const categories = [
  ['cafe', '카페'],
  ['restaurant', '식당'],
  ['exhibition', '전시'],
  ['walk', '산책'],
]

const tagGroups = {
  mood: [
    ['quiet', '조용한'],
    ['cozy', '아늑한'],
    ['trendy', '트렌디한'],
  ],
  situation: [
    ['rainy-day', '비 오는 날'],
    ['after-work', '퇴근 후'],
  ],
}

const prisma = createPrismaClient()

try {
  // 지역·카테고리·태그를 한 트랜잭션으로 묶어 도중에 실패하면 전체를 되돌린다.
  // createMany로 한 번에 넣고 skipDuplicates로 기존 ID와 운영자가 바꾼 이름을 보존한다.
  await prisma.$transaction([
    prisma.region.createMany({
      data: regions.map(([slug, name], sortOrder) => ({ slug, name, sortOrder })),
      skipDuplicates: true,
    }),
    prisma.category.createMany({
      data: categories.map(([slug, name], sortOrder) => ({ slug, name, sortOrder })),
      skipDuplicates: true,
    }),
    prisma.tag.createMany({
      data: Object.entries(tagGroups).flatMap(([kind, tags]) =>
        tags.map(([slug, name], sortOrder) => ({ kind, slug, name, sortOrder })),
      ),
      skipDuplicates: true,
    }),
  ])
  console.log('Seeded the initial regions, categories, and tags.')
} finally {
  // 중간에 오류가 나도 일회성 시드 스크립트의 DB 연결을 닫는다.
  await prisma.$disconnect()
}
