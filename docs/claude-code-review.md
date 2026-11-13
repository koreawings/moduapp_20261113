# KJ Trail 로컬 백엔드 독립 보안·정합성 교차검토 (Claude)

붙여 주신 코드와 테스트 텍스트만 읽고 검토했습니다. 코드를 실행하거나 웹을 열람하지 않았으므로 아래 "재현"은 코드 경로에 근거한 추론이며, 수정 후 회귀 테스트로 확인해야 합니다. 제시한 패치는 제안입니다.

## 요약

- 권한 우회로 확인되는 P0는 찾지 못했습니다.
  - 가입 시 role 필드는 INSERT에 쓰이지 않고, 역할과 정지는 요청마다 DB에서 읽습니다.
  - 모든 `/admin` 경로는 `requireCapability`를 거칩니다.
  - 채팅은 멤버십을 트랜잭션 밖에서 읽지만, 그 사이에 `await`가 없어 단일 프로세스에서는 경합이 없습니다.
- 콘텐츠 승인 경로에서 P1 두 건과 승인 분리 부재 한 건이 있습니다. 이 셋이 가장 위험합니다.

## P1

### P1-1. 현재 상태 필드가 검수 없이 바뀌고 낡은 검수 도장이 그대로 남습니다 (`validateCourse`)

- `materialKeys`에 `condition`, `conditionValidUntil`, `fetchedAt`이 없습니다.
- `condition === 'open'`과 유효기한 검사는 `body.approve === true` 안에서만 실행됩니다.
- 재현 경로:
  1. 한 번 승인된 게시 코스에 content 권한자가 `PATCH {version, condition:'open', conditionValidUntil:'9999-01-01T00:00:00Z', fetchedAt:<현재>, reason}`를 보냅니다. `approve`는 보내지 않습니다.
  2. `changed`가 false이므로 `reviewedAt`과 `reviewer`는 이전 값을 유지합니다.
  3. `courseOutput`에서 `recommendationEligible`이 true가 됩니다.
- 결과: 아무도 검토하지 않은 "개방" 상태로 능동 출발 추천이 가능합니다. 유효기한 상한도 없고, 미래의 `sourceEffectiveAt`도 거르지 않습니다.
- 패치:

```js
const statusKeys = ['condition','conditionValidUntil','fetchedAt'];
const statusChanged = !oldData || statusKeys.some(k => JSON.stringify(base[k]) !== JSON.stringify(merged[k]));
if (merged.condition === 'open' && statusChanged && body.approve !== true) {
  merged.condition = 'unknown'; merged.conditionValidUntil = null; // 검수 없는 open은 fail-closed
}
if (merged.condition === 'open') {
  const max = policy.maxStatusValidityMs;            // policy 키가 UNSET이면 open 승인 거부
  if (!max) fail(409,'policy_unset','현재 상태 유효기간 정책이 미설정입니다.');
  if (Date.parse(merged.conditionValidUntil) > time() + max) bad('유효기한이 정책 상한을 넘습니다.');
}
if (merged.sourceEffectiveAt && Date.parse(merged.sourceEffectiveAt) > time()) bad('출처 기준일은 미래일 수 없습니다.');
```

- `courseOutput`의 적격성에는 `Date.parse(data.reviewedAt) >= Date.parse(data.fetchedAt)`를 추가하세요. 승인이 수집보다 오래된 경우를 막습니다.
- 회귀 테스트:
  - 승인 후 `approve` 없는 `condition:'open'` PATCH는 `condition:'unknown'`이 되고 `recommendationEligible`이 false입니다.
  - 유효기한이 정책 상한을 넘으면 거부됩니다.

### P1-2. 유효기한이 지난 `open`이 공개 응답에 `condition:'open'`으로 남습니다 (`courseOutput`)

- 테스트는 `recommendationEligible:false`만 확인합니다. DB의 `condition`은 `open` 그대로이고 `GET /courses/:id`도 그대로 반환합니다.
- 프런트가 `condition` 필드를 쓰면 만료된 상태가 현재 개방으로 표시됩니다. 이는 현재 상태를 단정하지 말라는 원칙과 충돌합니다.
- 패치:

```js
const lapsed = data.condition !== 'unknown' && !(Date.parse(data.conditionValidUntil ?? '') > time());
return { ...data, condition: lapsed ? 'unknown' : data.condition,
         lastKnownCondition: lapsed ? data.condition : null, ... };
```

- `closed`도 만료 시 `unknown`이 되며, `unknown`은 추천에서 제외되므로 안전한 방향입니다. 다만 "통제 중이었으나 만료" 안내를 위해 `lastKnownCondition`은 별도 노출을 권합니다.
- 회귀 테스트: 시계를 앞으로 돌린 뒤 `GET /courses`와 `GET /courses/:id`의 `condition`이 `unknown`인지 확인합니다.

### P1-3. 번역 승인이 한 번의 호출로 자기 승인되고 번역 본문에 묶여 있지 않습니다

- 재현 경로: content 권한자가 `POST /admin/courses {...완전한 필드, approve:true, translationStatus:'approved', status:'published'}`를 보내면 한 번에 생성·승인·게시되고, 검수자는 본인입니다.
- 번역 본문은 어디에도 저장되지 않습니다. `translationStatus`는 언어 구분 없는 플래그 하나이고, 원문이 바뀌면 리셋되지만 번역 텍스트의 해시와는 연결되어 있지 않습니다.
- 따라서 "approved translation"이라는 적격성 조건은 현재 아무것도 증명하지 않습니다. 번역 오염을 감지할 수도 없습니다.
- 최소 패치:
  - 승인 capability를 `edit`와 분리합니다.
  - `translationStatus:'approved'`는 `approve` 권한자만 설정할 수 있게 합니다.
  - 정책 키 `requireSeparateApprover`가 APPROVED일 때는 `course_versions`의 직전 편집자와 승인자가 같으면 403을 반환합니다. 1인 운영이면 정책에서 끌 수 있지만, 그 사실이 감사 기록에 남아야 합니다.
- 정식 해결: `course_translations(course_id, locale, source_hash, title, summary, status, reviewer, reviewed_at)` 테이블을 두고, 적격성은 필수 로케일마다 `source_hash`가 현재 원문 해시와 같을 때만 true로 합니다.
- 이 변경이 들어가기 전까지는 API의 `translationStatus:'approved'`를 "번역 검수 완료"로 표시하면 안 됩니다.

## P2

**P2-1. 감사 기록의 불변성이 DB에 없습니다 (`database.mjs` 마이그레이션).** 현재 코드에는 `audit`를 지우는 경로가 없습니다. 그러나 명세의 "수정·삭제 불가"를 DB가 강제하지 않습니다. 새 마이그레이션 v2에 추가하세요.

```sql
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit is append-only'); END;
```

`course_versions`에도 같은 트리거를 권합니다. 현재 `if (version > 1)` 가드는 v2 추가 시 함께 올려야 합니다. 회귀 테스트: 직접 `UPDATE audit`와 `DELETE FROM audit`이 실패해야 합니다.

**P2-2. 공개 응답의 `reviewer`가 운영자 로그인 ID이고, 로그인 잠금과 결합합니다.**
- `reviewer = user.username`이 `GET /courses`에 그대로 노출됩니다.
- 로그인 제한 키 `login-user:${hash(username)}`은 IP와 무관하게 15분에 12회입니다.
- 공개 정보로 알아낸 검수자 계정에 틀린 비밀번호 12회를 보내면 그 운영자의 로그인을 계속 막을 수 있습니다. 관리자 계정은 `grant-admin`으로만 복구되므로 영향이 큽니다.
- 패치:
  - 공개 응답에서는 `reviewer`를 제거하고 `reviewed: boolean`만 남기거나 `reviewerDisplayName`을 씁니다. 로그인 ID는 `/admin/*` 응답에만 둡니다.
  - 사용자별 키를 `login-user:${ip}:${hash(username)}`로 바꿉니다.
- 테스트: 비인증 `GET /courses` 본문에 로그인 ID가 없어야 합니다.

**P2-3. 마이그레이션 버전 확인이 트랜잭션 밖에 있습니다 (`openDatabase`).** 서버와 `grant-admin` CLI가 빈 DB를 동시에 열면 둘 다 `version===0`을 읽습니다. 나중에 `BEGIN IMMEDIATE`를 얻은 쪽이 `CREATE TABLE users` 단계에서 "already exists"로 실패합니다. 트랜잭션 안에서 버전을 다시 읽고 이미 적용되어 있으면 건너뛰세요.

**P2-4. 잠금 중 ACK 재전송이 423을 받습니다 (POST messages).** `room.locked` 검사가 멱등 조회보다 앞에 있습니다. 메시지는 저장됐는데 ACK가 유실되고 그 사이에 방이 잠기면 재시도는 423을 받습니다. 사용자는 "실패"로 보고 새 키로 다시 보내므로, 잠금이 풀리면 중복 발화가 됩니다. 트랜잭션 안에서 `existing` 조회를 먼저 하고, 새 INSERT 직전에만 `locked`를 검사하세요(잠금을 트랜잭션 안에서 다시 읽는 것이 안전합니다). 기존 메시지는 `duplicate:true`로 응답합니다.

**P2-5. 댓글을 신고하거나 숨길 방법이 없고, 앞쪽 100개가 한 사람에게 점유될 수 있습니다 (`postOutput`).**
- `comments.hidden` 컬럼은 있으나 설정하는 경로가 없고, 신고 대상은 `message|post`뿐입니다.
- 목록은 `ORDER BY created_at LIMIT 100`이라 오래된 100개만 보입니다. 한 회원이 분당 30개 한도로 약 4분이면 한 게시글의 앞 100개를 채울 수 있습니다. 이후 정상 댓글은 영원히 보이지 않고, 운영자가 게시글 전체를 숨기는 것 외에 방법이 없습니다.
- 패치:
  - `targetType`에 `comment`를 추가하고 `resolve`가 `comments.hidden`을 갱신하게 합니다.
  - 게시글당 사용자별 댓글 수 상한을 둡니다.
  - 댓글 목록에 커서와 페이지네이션을 도입합니다.
  - 이 변경은 API 계약의 허용값을 바꾸므로 프런트 소유자에게 알려야 합니다.

**P2-6. 날짜·계정 입력의 사소한 경계 (참고).** `login`은 3자 미만 사용자명에 401 대신 400을 반환해, 형식 오류와 인증 실패가 구분됩니다. 위험은 작으나 일관성을 위해 인증 실패는 401로 통일하는 편이 낫습니다.

## 확인된 양호 항목 (코드 근거)

- 정지 시 세션 삭제, 요청마다 역할·정지 재검사, 자기·관리자 정지 차단.
- `joined_after_seq`로 같은 밀리초 문제와 재가입 이력 제외를 처리합니다.
- 감사 실패 시 롤백(트리거를 이용한 테스트 포함)과 신고 버전 동반 증가.
- Origin·Host·Content-Type 검사, SameSite=Strict 쿠키, 해시 저장 세션 토큰.
- 로그인에서 존재하지 않는 사용자에 대해서도 scrypt를 수행합니다.

## 미검증 한계

- 코드와 테스트를 실행하지 않았습니다. 14개 테스트의 통과 여부는 보고된 내용을 그대로 인용한 것이며, 위 P1·P2는 모두 기존 테스트가 다루지 않는 경로입니다.
- `fixtures.mjs`와 React 클라이언트는 받지 못했습니다. 사용자 입력(게시글, 메시지, 표시 이름)의 클라이언트 렌더링 XSS, 오류 메시지 처리, 언어 전환 시 입력 손실은 판단할 수 없습니다. 서버는 JSON만 반환하고 CSP가 있다는 사실만 확인됩니다.
- 단일 프로세스 가정입니다. 다중 프로세스, 다중 인스턴스, 프록시 뒤 IP 제한(현재 모두 소켓 주소를 쓰므로 하나로 합쳐질 수 있음), 메모리 내 rate limit 상태는 호스팅 이후 다시 설계해야 합니다.
- 3초 폴링 시 클라이언트당 최대 200건 조회와 `NOT EXISTS` 차단 필터의 성능, SQLite 동시 쓰기 한계, 백업·복원, WAL 파일 처리는 측정되지 않았습니다.
- 보존·삭제 정책이 미설정이므로 삭제 시험은 불가능합니다. `retentionConfigured:false`는 정직한 표기이지만 출시 게이트입니다.
- 이 검토는 작성자와 다른 관점의 정적 읽기입니다. 수정 후에는 클린 체크아웃에서 `npm run verify`를 새로 실행한 원본 로그로 재확인해야 합니다. 로컬 통합 테스트는 mock이 아니지만 호스팅 환경, 실제 계정 공급자, 실기기 검증을 대신하지 않습니다.
