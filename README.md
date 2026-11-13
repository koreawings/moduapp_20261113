# KJ Trail — 웹앱

소스 저장소: [koreawings/moduapp_20261113](https://github.com/koreawings/moduapp_20261113)

금정산 관광·코스 탐색과 웹앱 내부 커뮤니티를 함께 검토하는 **풀스택 앱**입니다. React 화면이 Node HTTP API·회원 세션과 연결됩니다. 로컬 실행에서는 `DATABASE_URL`이 있으면 PostgreSQL, 없으면 SQLite를 사용합니다. Vercel 배포에서는 PostgreSQL이 필수이며 `/api` 함수가 기존 회원·저장 기능을 제공합니다.

기본 운영 코스는 비어 있습니다. 별도 가상 예시는 화면 검토용이며 실제 산행·교통·안전 안내 또는 출발 추천으로 사용할 수 없습니다. 시험·코드 통과와 공개 운영 준비는 별도로 기록합니다.

## 처음 실행하기

준비: **Node.js 24.x**와 npm. PowerShell에서 이 폴더를 연 뒤 실행합니다.

```powershell
node --version
npm install
npm run verify
npm start
```

서버가 시작되면 [KJ Trail 로컬 화면](http://127.0.0.1:8787)을 엽니다. 주소는 `http://localhost:8787`로도 접근할 수 있습니다. 서버는 이 PC의 루프백 주소에서만 대기합니다. 종료할 때는 실행한 터미널에서 `Ctrl+C`를 누릅니다.

Windows에서는 압축을 푼 뒤 처음 한 번 `npm install`로 서버 의존성을 설치하고 `Start-KJ-Trail.cmd`를 더블클릭합니다. Node.js 24 이상이 필요합니다. `dist/`가 없으면 실행기가 검증과 빌드를 진행합니다. 서버 창은 사용하는 동안 열어 두세요.

이 PC의 Codex 번들 런타임을 사용하는 경우에는 npm이 PATH에 없어도 실행 보조 파일을 사용할 수 있습니다. 보조 파일은 설치된 Node를 먼저 찾고, 없으면 Codex 번들 Node를 찾습니다. PowerShell의 실행 정책이 스크립트를 막으면 정책을 우회하지 말고 위의 Node/npm 방법이나 실행 가능한 승인된 환경을 사용합니다.

```powershell
.\Start-KJ-Trail.ps1 -Mode verify
.\Start-KJ-Trail.ps1 -Mode start
```

회원 등록 후 관리 권한 부여도 지원합니다.

```powershell
.\Start-KJ-Trail.ps1 -Mode grant-admin -Username your-username
```

`npm run verify`는 타입 검사·테스트·빌드를 순서대로 수행합니다. 오류가 나오면 출력과 `reports/`의 결과를 확인합니다. 성공하지 않은 단계를 통과로 처리하지 않습니다. 패키지 설치가 끝난 뒤 코드만 바꾸었다면 설치를 반복할 필요가 없습니다.

개발 중에는 다음 명령을 사용합니다.

```powershell
npm run dev
```

개발 화면은 `http://127.0.0.1:5173`, API는 `http://127.0.0.1:8787`입니다. 일반 실행(`npm start`)과 개발 실행을 동시에 켜면 같은 API 포트가 충돌하므로 하나만 실행합니다.

## Supabase 환경변수

프로젝트 루트의 `.env.local`에 다음 항목을 설정합니다. 서버와 관리자 CLI는 `.env.local`, `.env`를 읽으며 이미 설정된 시스템 환경변수가 우선합니다. 설정을 수정하면 서버를 다시 시작하세요.

```dotenv
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
DATABASE_URL=postgresql://kj_trail_backend.PROJECT_REF:PERCENT_ENCODED_PASSWORD@POOLER_HOST:5432/postgres
```

실제 DB 저장에 사용하는 값은 **서버 전용 `DATABASE_URL`**입니다. Supabase의 Connect → Direct → Session pooler에서 주소를 확인하고, 사용자명은 `kj_trail_backend.PROJECT_REF`로 설정합니다. 비밀번호의 특수문자는 URL 인코딩해야 합니다. IPv6 직접 연결에서는 사용자명이 `kj_trail_backend`입니다. `SUPABASE_URL`과 publishable key만 설정하면 DB 저장소가 전환되지는 않습니다.

새 Supabase 프로젝트는 먼저 [DB 스키마](db/schema.sql)를 SQL Editor에서 한 번 실행하고 전용 역할의 로그인 비밀번호를 설정합니다. 이미 설치한 스키마를 재실행하거나 초기화하지 마세요. 서버는 시작할 때 `kj_trail`의 스키마 버전과 테이블을 검증하며 DB 권한을 자동 확대하지 않습니다. 이 스키마는 Data API에 공개하지 않습니다. 기존 Node API가 회원 인증과 작업 권한을 확인합니다.

원격 DB 연결은 TLS 인증서와 호스트 이름을 검증합니다. 사용자 지정 CA가 필요한 경우 `DATABASE_SSL_CA`에 Supabase에서 받은 인증서 파일 경로를 지정합니다. 접속 실패 시 SQLite로 자동 전환하지 않습니다. 실행 후 `/api/health`의 `storage`가 `postgresql`인지 확인하세요. 회원·세션·코스·게시글·채팅·신고·감사 기록이 같은 DB에 저장되고, 개인 여행 계획/저장 목록은 기존처럼 브라우저에 남습니다.

PostgreSQL 테스트는 메모리 내의 격리된 PostgreSQL 엔진에 실제 pg 드라이버로 접속하며 원격 운영 DB를 사용하지 않습니다. `npm run test:postgres`로 단독 실행할 수 있습니다.

`.env.example`은 공유용 빈 양식입니다. 실제 `.env.local`과 DB 비밀번호는 Git 및 배포 ZIP에서 제외합니다. 기존 SQLite 데이터가 있다면 별도 이관이 필요하며, 연결 변경만으로 기존 파일을 자동 업로드하지 않습니다.

## 회원과 관리자

Vercel 배포는 아래 [Vercel 배포](#vercel-배포)와 [배포 안내](docs/vercel.md)를 참고하세요. 관리 권한 부여는 배포와 같은 DB를 사용하는 로컬 CLI에서 실행합니다.

1. 화면에서 본인이 사용할 계정을 등록합니다. 사용자명은 영문·숫자로 시작하는 3~32자이며 이후 밑줄·점·하이픈도 허용합니다. 비밀번호는 12자 이상입니다.
2. 관리자 권한이 필요한 계정에 한해 이 PC의 별도 터미널에서 실행합니다. `your-username`은 방금 등록한 실제 사용자명으로 바꿉니다.

```powershell
npm run grant-admin -- your-username
```

3. 화면에서 로그아웃한 뒤 다시 로그인하고 관리자 메뉴를 엽니다.

기본 관리자 계정·비밀번호는 없습니다. 회원가입 요청이나 화면 조작으로 역할을 올릴 수 없습니다. 이 명령은 로컬 OS 권한을 가진 사람이 등록된 계정에 역할을 부여하는 초기 설정 경로이며, 조치가 감사 기록에 남습니다.

## 확인할 흐름

- 코스 탐색: 기본 공개 코스 0건과 가상 예시 표시를 구분합니다.
- 추천: 직접 탐색 또는 6문항을 사용합니다. 교통수단·동행은 준비 안내로 사용합니다. 실제 승인·운영 상태 근거가 없는 코스는 능동 추천하지 않습니다.
- 커뮤니티: 서로 다른 계정을 일반 창과 별도 브라우저 프로필/시크릿 창에서 사용합니다. 같은 방에 참여한 뒤 메시지·새로고침·재시도를 확인합니다.
- 운영: 메시지·게시물·댓글 신고를 접수하고 관리자 화면에서 숨김·복구·기각 후 회원 화면과 감사 기록에 반영되는지 확인합니다.
- 언어: 한국어·영어·번체중문 UI를 선택할 수 있습니다. 코스는 영어·번체중문 코스명/설명/출발지와 원문·번역 지문을 함께 관리합니다. 승인 표시만으로 독립된 사람의 번역 검수가 완료되었다는 뜻은 아닙니다.

채팅은 **3초마다 권한을 확인하며 갱신하는 폴링**입니다. 현재 참여 이후의 최근 최대 200개 메시지를 조회합니다. WebSocket, 푸시 알림, 1:1 DM, 사진 전송, 위치 공유, 자동 구조 기능은 제공한다고 주장하지 않습니다. 재참여 시 이전 참여 이력이 자동 복원되는 서비스가 아닙니다.

게시물 댓글은 숨김·차단을 제외한 최근 최대 100개를 표시합니다. 더 오래된 댓글을 불러오는 기능은 아직 없습니다. 방이 잠긴 뒤에도 이미 저장된 동일 메시지의 재시도 응답은 현재 권한 내에서 받을 수 있지만 새 메시지는 보낼 수 없습니다.

코스 원문·번역 변경은 초안 저장 후 별도로 승인합니다. 현재는 같은 운영자가 저장과 승인을 할 수 있는 로컬 모드입니다. 개방 상태의 유효기한에는 기본 24시간 기술 상한이 있으며, 이 시간이 현장 상태나 안전을 보장하지 않습니다. 만료된 개방 상태는 확인 필요로 바뀌고 추천에서 제외됩니다. 공개 운영 전에는 실제 검토와 운영 정책을 확정해야 합니다.

## Vercel 배포

1. Vercel에서 `koreawings/moduapp_20261113`의 `main`을 가져옵니다. Root Directory는 저장소 루트입니다.
2. Environment Variables에 `DATABASE_URL`과 `DATABASE_SSL_CA=certs/supabase-ca.crt`를 등록합니다. `DATABASE_URL`에는 Supabase **Transaction pooler(6543)**와 `kj_trail_backend.PROJECT_REF` 전용 계정을 사용합니다. 실제 비밀번호가 포함된 값은 Git에 넣지 않습니다.
3. Deploy 또는 Redeploy를 실행합니다. `vercel.json`이 Vite 빌드, `dist`, API 연결, CA 파일 포함을 설정합니다. Node.js는 24.x로 고정되어 있습니다.
4. 배포 주소의 `/api/health`에서 `mode: "hosted"`, `storage: "postgresql"`, `ok: true`를 확인하고 회원가입·로그인·저장을 확인합니다.

Vercel의 현재 배포 URL, 운영 대표 도메인 또는 미리보기 브랜치 주소를 정확히 허용합니다. 추가 운영 도메인이 있으면 Production 환경에 `APP_ORIGIN=https://실제도메인`을 설정합니다. 로그인 쿠키는 HTTPS 전용이며 알 수 없는 호스트와 다른 출처의 요청을 거부합니다. `NEXT_PUBLIC_*`나 `VITE_*` DB 비밀값은 사용하지 않습니다. `SUPABASE_URL`·publishable key는 현재 서버의 DB 저장에 필요하지 않습니다.

빌드·API 구성과 오류 확인 방법: [Vercel 배포 안내](docs/vercel.md).

## 턴키 검증·재개

```powershell
npm run turnkey -- check
npm run turnkey -- --next
npm run turnkey -- --resume
npm run turnkey -- status
```

실행기는 Node/SQLite·의존성·타입·SQLite와 PostgreSQL API 테스트·빌드를 확인하고 입력 지문·종료 코드·로그를 남깁니다. `--next`는 다음 검증 한 단계, `--resume`는 실패/미실행 단계부터 재개합니다. 입력이 바뀌면 새 검증으로 전환합니다. 실제 고객 근거가 없는 P11·P12나 공개 출시를 자동 완료 처리하지 않습니다.

npm이 PATH에 없더라도 이미 의존성이 준비됐다면 Node 24 실행파일로 `scripts/turnkey.mjs`와 `scripts/verify.mjs`를 직접 실행할 수 있습니다. 자세한 계약은 [턴키 실행 안내](docs/turnkey.md)를 참고합니다.

## 데이터와 한계

- 기본 SQLite 파일: `data/kj-trail.sqlite`. 로컬 회원·게시물·채팅·감사 기록을 저장합니다.
- 스키마 v2는 기존 신고를 보존하고 댓글 신고를 지원합니다. 감사·코스 버전 이력의 수정/삭제는 DB 트리거로 막으며, DB 파일을 직접 관리하는 사람에 대한 변조 방지 보장은 아닙니다.
- DB 위치를 바꾸는 환경변수: `KJ_DB_PATH`. 서버와 관리자 CLI에 같은 값을 사용해야 합니다.
- 포트 환경변수: `PORT`(기본 8787). 개발 프록시의 기본 포트도 함께 고려해야 합니다.
- 데이터·로그·비밀값·의존성·빌드 산출물은 Git에 넣지 않습니다.
- 로그인 세션은 로컬 시험 환경 설정을 따릅니다. 메시지·신고·계정의 자동 보관 만료·삭제 정책은 아직 공개 운영용으로 확정되지 않았습니다.
- 공개 서비스로 전환하려면 승인 콘텐츠, 번역, 브랜드·사진 권리, 운영 담당, HTTPS 호스팅, 개인정보·보관 정책, 비용 한도, 백업 복구 검증이 필요합니다. 현재 로컬 서버를 그대로 인터넷에 노출하는 배포 안내는 아닙니다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [API 계약](API-CONTRACT.md) | 실제 프론트·백엔드 경계와 오류·권한 |
| [실행 프롬프트 13종](docs/original-execution-prompts.md) | P00~P12 원문 |
| [턴키·인계 순서](docs/turnkey.md) | 계약 선행 순서, 재개·원장, 현재 구현 차이 |
| [턴키 실행기 별도 검증](docs/turnkey-review.md) | 격리 환경 CLI 17회 시험의 범위·증거·한계 |
| [코드북](docs/codebook.md) | 실제 경로·역할·검증 위치 |
| [운영·복구](docs/operations.md) | 관리자 업무, 데이터 백업·복원, 장애 대응 |
| [수용 기준](docs/acceptance.md) | 코드·콘텐츠·디자인·운영의 검수 표 |
| [실제 피드백·MVP2](docs/feedback.md) | 증거 기반 개선 카드와 다음 단계 |
| [Claude 검토 원문](docs/claude-turnkey-review.md) | 교차 검토 제안과 한계 |

## 자주 막히는 경우

| 현상 | 확인할 내용 |
| --- | --- |
| `node` 또는 `npm`을 찾을 수 없음 | Node 24 설치·PATH를 확인하고 새 터미널을 엽니다. 관리자 권한 우회 명령은 필요하지 않습니다. |
| `node:sqlite`를 사용할 수 없음 | 실행 중인 `node --version`이 24 이상인지 확인합니다. |
| 포트 사용 중 | 이전 `npm start`/`npm run dev`를 켠 터미널을 종료합니다. 모르는 프로세스를 임의로 종료하지 않습니다. |
| 클라이언트 빌드 없음 | `npm run verify` 또는 `npm run build` 결과를 확인합니다. |
| 관리자 메뉴가 보이지 않음 | 실제 등록 사용자명, 서버/CLI의 DB 경로 일치, 재로그인을 확인합니다. |
| 추천 결과 없음 | 기본 상태에서는 정상입니다. 실제 검토를 거치지 않은 예시를 승인 코스로 바꾸지 않습니다. |
| 실행기 잠금 메시지 | 이미 실행 중인 검증을 확인합니다. 원장을 지우거나 동시에 실행하지 않습니다. |
