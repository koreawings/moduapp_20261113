# Vercel 배포

## 프로젝트 설정

GitHub의 `koreawings/moduapp_20261113`, Production Branch `main`, Root Directory는 저장소 루트를 선택한다. `vercel.json`은 Vite 빌드와 `dist` 출력, API 라우팅, CA 인증서 포함을 정의한다. Node.js는 `package.json`의 24.x를 사용한다. 설치 명령은 pnpm 11.25.0과 frozen lockfile을 명시한다.

`api/index.js`가 `/api` 요청을 기존 Node 핸들러로 전달한다. 함수는 별도 리스닝 소켓을 만들지 않는다. 정적 화면은 Vercel에서 제공하고 API 실패나 알 수 없는 API 경로를 SPA HTML로 바꾸지 않는다.

## Environment Variables

| Name | Value | 범위 |
| --- | --- | --- |
| `DATABASE_URL` | 전용 역할의 Supabase Transaction pooler 연결 문자열, 포트 6543 | 서버 전용, Production |
| `DATABASE_SSL_CA` | `certs/supabase-ca.crt` | 서버 전용, Production |
| `APP_ORIGIN` | 추가 운영 도메인이 있을 때만 `https://실제도메인` | 선택, Production |

Preview에서 DB를 사용하려면 Preview 범위에도 별도 연결 설정을 등록한다. 현재 서버는 환경별로 받은 연결 문자열을 그대로 사용하므로 같은 값을 넣으면 같은 DB를 사용한다. 환경변수 변경 후에는 Redeploy해야 한다.

`DATABASE_URL` 형식은 `postgresql://kj_trail_backend.PROJECT_REF:URL_ENCODED_PASSWORD@POOLER_HOST:6543/postgres`다. `NEXT_PUBLIC_`나 `VITE_` 접두사를 붙이지 않는다. Supabase URL/publishable key만으로 서버 DB 저장이 연결되지는 않는다. 기존 스키마는 다시 실행하지 않는다.

Vercel의 System Environment Variables 자동 노출을 켠다. 서버는 `VERCEL_URL`과 환경별 도메인을 사용한다. Production에서는 `VERCEL_PROJECT_PRODUCTION_URL`과 선택한 `APP_ORIGIN`을, Preview에서는 `VERCEL_BRANCH_URL`을 허용한다. 임의의 `*.vercel.app` 전체를 허용하지 않으며 Preview가 운영 도메인을 자동으로 신뢰하지 않는다. 외부 프록시의 Host/Proto 값으로 이 허용 목록을 넓히지 않는다.

`NODEJS_HELPERS=0`은 `vercel.json`에 빌드 및 런타임용으로 포함된 공개 설정이다. 기존 API가 원본 요청 본문을 32KiB까지 직접 읽고 검증할 수 있도록 Vercel의 본문 사전 버퍼링을 끈다. 사용자 비밀번호나 DB 연결 값은 해당 설정 파일에 포함하지 않는다.

## 저장과 세션

Vercel에서는 `DATABASE_URL`이 없거나 초기 연결에 실패하면 JSON 503을 반환한다. SQLite 파일을 생성하거나 저장소를 자동 변경하지 않는다. 실패한 초기 풀을 닫고 다음 요청에서 초기화를 다시 시도한다. 정상 초기화 후에는 같은 함수 인스턴스에서 앱과 풀을 재사용한다.

풀은 인스턴스당 최대 3개 연결이며 `attachDatabasePool`로 유휴 연결 정리를 연결한다. Supabase 트랜잭션 풀러를 사용하고 서버 인증·권한 검사·감사 기록의 기존 트랜잭션을 유지한다. 로그인 쿠키는 `Secure; HttpOnly; SameSite=Strict`다.

기존 요청 제한은 함수 인스턴스 메모리에 있으므로 전체 배포에 걸친 전역 요청 한도를 보장하지 않는다. 실제 공개 운영의 트래픽 제한·운영 정책·백업 검증은 별도로 확인한다.

## 배포 확인

1. Vercel 빌드가 성공했는지 확인한다.
2. `https://배포주소/api/health`에서 `ok: true`, `mode: "hosted"`, `storage: "postgresql"`을 확인한다.
3. 실제 사용할 계정을 등록하고 로그아웃·재로그인, 게시글 저장·새로고침을 확인한다.
4. 관리자 권한이 필요하면 같은 Supabase DB를 사용하는 로컬 프로젝트에서 `npm run grant-admin -- 등록한사용자명`을 실행한다.

503이면 DB URL·비밀번호·CA 경로와 Vercel 시스템 변수를 확인한다. `invalid_host`이면 현재 주소가 운영/배포/브랜치 도메인 또는 `APP_ORIGIN`에 포함되는지 확인한다. `origin_rejected`이면 요청을 현재 배포의 HTTPS 화면에서 다시 보낸다. 로그에 실제 연결 문자열이나 요청 비밀번호를 남기지 않는다.

## 구현 검증 기록 (2026-11-13)

`npm run verify`에서 타입 검사, 일반·호스팅 테스트 43개, PostgreSQL 테스트 7개와 Vite 빌드가 통과했다. 실제 `@vercel/node` 실행기에서 `/api/health`의 hosted/PostgreSQL 응답과 `/api/courses` 조회를 확인했고, 잘못된 JSON은 400, 크기 초과 요청은 413으로 거부됐다. 원격 DB 확인에는 읽기 요청만 사용했다.

Vercel 설정 스키마·라우팅 컴파일과 함수 파일 추적도 확인했다. 번들에는 CA와 서버 의존성이 포함되며 실제 환경파일·런타임 DB·테스트 파일은 포함되지 않는다. 이 기록은 클라우드 배포 완료를 의미하지 않는다. 배포 후 위 확인 절차로 실제 도메인과 Edge rewrite를 거친 로그인·저장을 확인한다.

## 참고

- [Vercel Node.js 함수](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel 환경변수](https://vercel.com/docs/environment-variables)
- [Vercel DB 풀 관리](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#attachdatabasepool)
- [Supabase DB 연결과 풀러](https://supabase.com/docs/guides/database/connecting-to-postgres)
