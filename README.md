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
