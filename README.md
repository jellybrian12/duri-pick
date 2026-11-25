두리픽

## 로컬 개발

저장소 루트에서 의존성을 설치합니다. 프론트엔드와 백엔드는 하나의 npm 잠금 파일을 사용합니다.

```sh
npm ci
```

각 명령은 별도 터미널에서 실행합니다.

| 명령 | 역할 | 기본 주소 |
| --- | --- | --- |
| `npm run dev` | `frontend/`의 React·Vite 개발 서버 | `http://localhost:5173` |
| `npm run dev:backend` | `backend/`의 Express 서버 | `http://127.0.0.1:3001` |

프론트 개발 서버는 `/api/v1` 요청을 Express로 전달합니다. 두 서버를 실행한 뒤 `http://localhost:5173/api/v1/health`를 열면 `{ "status": "ok" }` 응답을 확인할 수 있습니다.

`npm run build`와 `npm run lint`는 프론트엔드에 적용됩니다. 프로젝트 명세는 [docs/](docs/)에 있습니다.

## 로컬 PostgreSQL과 Prisma

Node.js 24와 Docker Desktop을 사용합니다. 저장소 루트에서 `npm ci`를 실행한 뒤 `backend/.env.example`을 `backend/.env`로 복사합니다. `DATABASE_URL`에 [compose.yaml](compose.yaml)의 로컬 DB 접속 정보를 입력합니다. 기존 PostgreSQL을 쓰는 경우 해당 개발 DB 주소를 입력합니다.

```sh
docker compose up -d --wait db
npm run db:generate --workspace backend
npm run db:migrate --workspace backend
npm run db:seed --workspace backend
```

시드는 출시 지역 7곳, 카테고리, 분위기·상황 태그를 추가합니다. 다시 실행해도 기존 행과 ID는 유지됩니다. `docker compose stop db`로 DB를 중지할 수 있으며, 다음에 시작하면 같은 볼륨을 사용합니다.

### 백엔드 코드 읽는 순서

1. [compose.yaml](compose.yaml)에서 DB 서버를 시작하고, [prisma.config.js](backend/prisma.config.js)에서 Prisma CLI가 사용할 연결 주소와 파일 위치를 정합니다.
2. [schema.prisma](backend/prisma/schema.prisma)는 모델과 관계를 정의합니다. `db:generate`는 이 모델에서 조회·저장에 사용할 클라이언트 코드를 만듭니다.
3. [초기 마이그레이션](backend/prisma/migrations/20261125000000_init/migration.sql)은 실제 테이블과 인덱스를 생성합니다. `BEGIN`과 `COMMIT` 사이의 변경은 함께 적용되며, SQL의 `CHECK`는 Prisma를 거치지 않는 입력에도 적용됩니다. 이미 적용한 마이그레이션은 체크섬으로 관리되므로 DB 구조 변경은 새 마이그레이션에 담습니다.
4. [db.js](backend/src/db.js)는 생성된 Prisma Client를 PostgreSQL에 연결합니다. [seed.js](backend/prisma/seed.js)는 이 연결로 초기 분류 데이터를 저장합니다.
