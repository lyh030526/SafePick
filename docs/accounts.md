# 로그인·마이페이지 설정

SafePick은 로그인 없이도 판매 페이지를 분석합니다. 로그인하면 분석 기록이 저장되고, 관심 판매처를 저장하고, 닉네임 변경·로그아웃·회원 탈퇴를 할 수 있습니다.

## 구조

| 부분 | 맡는 일 |
| --- | --- |
| Supabase Auth | 카카오·Google 로그인, 세션 발급 |
| Supabase Postgres | `profiles`(닉네임), `analyses`(분석 기록), `saved_listings`(관심 판매처). 행 수준 보안으로 본인 행만 읽고 쓸 수 있음 |
| 앱 (`apps/mobile`) | Expo Router 화면: `/`(분석), `/sign-in`, `/my`(마이페이지), `/history`, `/saved`. 공개 키로 Supabase에 직접 읽고 씀 |
| FastAPI (`apps/api`) | 분석은 그대로. `DELETE /account`만 추가: 로그인 토큰을 Supabase에 확인한 뒤 비밀 키로 사용자를 삭제 |

- 분석 기록에는 판매 페이지 주소, 상품명, 판매자, 가격, 주의 수준·점수·요약, 분석 결과를 저장합니다. 확장 프로그램이나 사용자가 넣은 상품 설명 원문(`sale_text`)은 저장하지 않습니다.
- 회원 탈퇴는 Supabase 사용자를 지우고, 외래 키(`on delete cascade`)로 프로필·분석 기록·관심 판매처가 함께 지워집니다.
- `/my`, `/history`, `/saved`는 로그인한 사용자만, `/sign-in`은 로그인하지 않은 사용자만 열립니다(`Stack.Protected`). 저장된 세션을 읽는 동안에는 막지 않아서, 마이페이지에서 새로고침해도 그대로 남습니다.

## 1. Supabase 프로젝트

1. [Supabase](https://supabase.com/)에서 프로젝트를 만듭니다.
2. SQL Editor에서 [`supabase/migrations/20261103000000_accounts.sql`](../supabase/migrations/20261103000000_accounts.sql)을 실행합니다. Supabase CLI를 쓰면 `supabase db push`로도 적용할 수 있습니다.
   처음부터 다시 만들고 싶으면 [`supabase/reset.sql`](../supabase/reset.sql)을 실행합니다. SafePick 테이블·트리거·함수를 지우고 빈 상태로 다시 만들며, **프로필·분석 기록·관심 판매처가 모두 삭제됩니다**(로그인 계정은 남고, 지우려면 파일 안의 `delete from auth.users;` 주석을 풉니다). `supabase db push`로 실행되지 않도록 migrations 폴더 밖에 두었습니다.
3. Project Settings → API Keys에서 **Publishable key**(`sb_publishable_...`)와 **Secret key**(`sb_secret_...`)를 확인합니다.

## 2. 로그인 제공자 (카카오·Google)

### 먼저 알아 둘 흐름

'로그인 제공자'는 SafePick 대신 본인 확인을 해 주는 곳(카카오, Google)입니다. SafePick은 비밀번호를 받지 않고, 제공자가 "이 사람 맞다"고 확인해 준 결과만 받습니다. 중간에서 Supabase가 그 결과를 받아 로그인 세션으로 바꿔 줍니다.

```
① 앱에서 [카카오로 시작하기] 누름
② 카카오 로그인·동의 화면 (카카오 사이트)
③ 카카오 → Supabase로 돌아감      : https://<프로젝트>.supabase.co/auth/v1/callback   ← "콜백 주소"
④ Supabase → SafePick 앱으로 돌아감 : http://localhost:8081/sign-in                    ← "앱 복귀 주소"
⑤ 로그인 완료, 마이페이지 사용 가능
```

주소가 두 종류라서 헷갈리기 쉽습니다.

| 어디에 넣나 | 넣는 주소 | 뜻 |
| --- | --- | --- |
| 카카오·Google 개발자 화면 | **콜백 주소** `https://<프로젝트>.supabase.co/auth/v1/callback` | 로그인이 끝나면 Supabase로 보내라 (③) |
| Supabase 화면 (URL Configuration) | **앱 복귀 주소** `http://localhost:8081/sign-in` | 로그인이 끝나면 SafePick으로 보내라 (④) |

콜백 주소는 Supabase 대시보드 **Authentication → Sign In / Providers**에서 Kakao나 Google을 펼치면 나오는 **Callback URL** 옆 **Copy** 버튼으로 복사합니다. `<프로젝트>` 자리에는 프로젝트마다 다른 영문·숫자가 들어갑니다.

키도 두 개씩 주고받습니다.

| 제공자 화면에서 받는 값 | Supabase에 넣는 칸 |
| --- | --- |
| 카카오 **REST API 키** | Kakao Client ID |
| 카카오 **Client Secret 코드** | Kakao Client Secret |
| Google **클라이언트 ID** | Client IDs |
| Google **클라이언트 보안 비밀번호** | Client Secret |

### 카카오

[Kakao Developers](https://developers.kakao.com/)에 카카오 계정으로 로그인합니다. (메뉴 이름은 카카오가 화면을 바꾸면 조금 달라질 수 있습니다.)

1. **앱 만들기**: 상단 **앱(내 애플리케이션)** → **앱 만들기(애플리케이션 추가)**. 앱 이름 `SafePick`, 회사명(개인이면 본인 이름), 카테고리를 넣고 저장합니다.
2. **REST API 키 복사**: 만든 앱 → **앱 설정 → 앱 → 플랫폼 키(앱 키)**에서 **REST API 키**를 복사합니다. → Supabase의 *Kakao Client ID*.
3. **콜백 주소 등록**: 같은 화면에서 REST API 키를 눌러 **카카오 로그인 Redirect URI**에 위의 **콜백 주소**를 넣고 저장합니다. 앱 복귀 주소(localhost:8081)가 아니라 Supabase 주소입니다.
4. **Client Secret 만들기**: 같은 REST API 키 화면(예전 화면은 **제품 설정 → 카카오 로그인 → 보안**)에서 **카카오 로그인 Client Secret** 코드를 만들고 **사용함(활성화)**으로 둡니다. 코드를 복사합니다. → Supabase의 *Kakao Client Secret*.
5. **카카오 로그인 켜기**: **제품 설정 → 카카오 로그인 → 일반(활성화 설정)**에서 상태를 **ON**으로 합니다.
6. **동의항목**: **제품 설정 → 카카오 로그인 → 동의항목**에서 **닉네임(profile_nickname)**, **프로필 사진(profile_image)**, **카카오계정(이메일)(account_email)**을 켭니다.
   - Supabase의 카카오 로그인은 앱 코드와 상관없이 **이메일을 항상 함께 요청**합니다. 이메일 항목을 켜지 않으면 로그인 때 **KOE205(설정하지 않은 동의항목)** 오류가 납니다.
   - 이메일 항목은 **비즈 앱**만 켤 수 있습니다. 사업자 번호가 없으면 **앱 설정 → 일반 → 비즈니스 정보**에서 먼저 **앱 아이콘을 등록**하고(예: `apps/mobile/assets/safepick-icon.png`), 본인인증과 카카오비즈니스 통합 서비스 약관 동의를 마친 뒤 **[개인 개발자 비즈 앱 전환]**을 누릅니다. 이메일 항목 사용에 심사가 필요할 수 있습니다.

Supabase 대시보드:

7. **Authentication → Sign In / Providers → Kakao**를 펼쳐 **Kakao Enabled**를 켭니다.
8. **Kakao Client ID**에 2번의 REST API 키, **Kakao Client Secret**에 4번의 코드를 넣습니다.
9. **Allow users without an email(이메일 없는 사용자 허용)**을 켭니다. 이걸 끄면 이메일을 주지 않는 카카오 계정은 로그인에 실패합니다.
10. **Save**.

### Google

[Google Cloud Console](https://console.cloud.google.com/)에 Google 계정으로 로그인합니다.

1. **프로젝트**: 상단 프로젝트 선택 → **새 프로젝트** → 이름 `SafePick`.
2. **Google 인증 플랫폼(Google Auth Platform)** 메뉴(검색창에 "Google Auth Platform" 또는 "OAuth 동의 화면")로 갑니다. 처음이면 **시작하기**를 눌러 앱 이름 `SafePick`, 지원 이메일을 넣습니다.
   - **대상(Audience)**: 사용자 유형 **외부**. 처음에는 '테스트' 상태라 **테스트 사용자**에 추가한 Google 계정만 로그인할 수 있습니다. 개발 중에는 본인 계정을 테스트 사용자로 추가하고, 출시할 때 **앱 게시**를 누릅니다.
   - **데이터 액세스(Data Access)**: 기본으로 들어 있는 이메일·프로필 범위로 충분합니다(`openid`가 없으면 추가).
3. **클라이언트(Clients)** → **클라이언트 만들기** → 애플리케이션 유형 **웹 애플리케이션**.
   - **승인된 자바스크립트 원본**: `http://localhost:8081` (주소 뒤에 경로 없이). 실제 서비스 주소가 생기면 그 주소도 추가합니다.
   - **승인된 리디렉션 URI**: 위의 **콜백 주소** `https://<프로젝트>.supabase.co/auth/v1/callback`.
4. **만들기**를 누르면 나오는 **클라이언트 ID**와 **클라이언트 보안 비밀번호**를 복사합니다(보안 비밀번호는 이때만 전체가 보일 수 있으니 바로 저장).

Supabase 대시보드:

5. **Authentication → Sign In / Providers → Google**을 펼쳐 켜고, **Client IDs**에 클라이언트 ID, **Client Secret**에 보안 비밀번호를 넣고 **Save**.

### Supabase: 앱 복귀 주소 허용

**Authentication → URL Configuration**에서:

- **Site URL**: 개발 중에는 `http://localhost:8081` (실제 서비스 주소가 생기면 그 주소로 바꿈).
- **Redirect URLs**에 아래를 추가합니다. 여기 없는 주소로는 Supabase가 돌려보내지 않습니다.
  - 웹 개발: `http://localhost:8081/sign-in`
  - 휴대폰 앱(개발 빌드): `safepick://sign-in` (앱 스킴 `safepick`)

### 자주 막히는 곳

| 증상 | 원인 |
| --- | --- |
| 카카오에서 "Redirect URI 불일치(KOE006)" | 카카오에 등록한 Redirect URI가 Supabase 콜백 주소와 한 글자라도 다름 |
| Google에서 "redirect_uri_mismatch" | Google 클라이언트의 승인된 리디렉션 URI에 Supabase 콜백 주소가 없음 |
| Google에서 "액세스 차단됨: 앱이 테스트 중" | 테스트 상태인데 로그인한 계정이 테스트 사용자에 없음 |
| 카카오 "Invalid Request (KOE205)" | 카카오 동의항목에 카카오계정(이메일)이 없음 (Supabase가 이메일을 항상 요청함) → 비즈 앱 전환 후 이메일 항목 켜기 |
| 카카오 로그인 후 "이메일 필요" 오류 | Supabase 카카오 설정의 Allow users without an email이 꺼져 있음 |
| 로그인은 됐는데 앱이 아닌 Supabase 기본 주소로 감 | URL Configuration의 Redirect URLs에 `http://localhost:8081/sign-in`이 없음 |
| 앱의 로그인 버튼이 눌리지 않음 | `apps/mobile/.env.local`에 Supabase 주소·공개 키가 없거나, 넣은 뒤 앱을 다시 시작하지 않음 |

## 3. 환경 변수

### 환경 변수가 뭐냐면

주소와 키처럼 **사람마다·서버마다 다르고, 코드에 적으면 안 되는 값**을 담는 설정 파일입니다. 코드는 그대로 두고 이 파일만 바꿔 다른 Supabase 프로젝트에 연결할 수 있고, 이 파일들은 git에 올라가지 않아 키가 저장소에 남지 않습니다.

SafePick에는 파일이 두 개 있고, 각자 다른 키를 씁니다.

| 파일 | 누가 읽나 | 넣는 값 | git |
| --- | --- | --- | --- |
| `apps/mobile/.env.local` | 앱(화면) | Supabase 주소 + **공개 키** | 올라가지 않음 |
| `apps/api/.env` | 서버(FastAPI) | Supabase 주소 + **비밀 키** (+ 기존 OpenAI·검색·공공데이터 키) | 올라가지 않음 |

각 폴더의 `.env.example`은 "어떤 칸이 있는지" 보여 주는 견본이라 git에 올라가 있고, 값은 비어 있습니다.

### 값은 어디서 가져오나

Supabase 대시보드에서 프로젝트를 연 뒤:

| 값 | 위치 | 생김새 |
| --- | --- | --- |
| 프로젝트 주소 | **Project Settings → Data API**의 **Project URL** (또는 홈 화면의 Project URL) | `https://abcdefghijklmnop.supabase.co` |
| 공개 키 | **Project Settings → API Keys**의 **Publishable key** | `sb_publishable_...` |
| 비밀 키 | 같은 화면의 **Secret keys** (처음이면 **Create new secret key**, 값은 눈 아이콘을 눌러 확인) | `sb_secret_...` |

예전 프로젝트 화면에는 **anon / service_role** 키로 보일 수 있습니다. 그때는 anon이 공개 키, service_role이 비밀 키 자리입니다.

### 공개 키와 비밀 키의 차이 (중요)

- **공개 키**: 앱 안에 들어가 사용자 기기로 내려가는 값이라 남이 봐도 됩니다. 이 키로는 데이터베이스의 행 수준 보안 규칙(본인 기록만 읽기·쓰기)을 넘을 수 없습니다.
- **비밀 키**: 모든 규칙을 무시하고 모든 사용자의 데이터를 읽고 지울 수 있는 관리자 키입니다. **서버 파일(`apps/api/.env`)에만** 넣고, 앱 파일·코드·채팅·캡처에 절대 넣지 마세요. 유출되면 Supabase에서 그 키를 삭제(revoke)하고 새로 만듭니다.
- 이름 규칙: 앱에서 쓰는 변수는 `EXPO_PUBLIC_`으로 시작해야 앱에 전달되고, 이 접두사가 붙은 값은 전부 공개된다고 생각해야 합니다. 그래서 비밀 키에는 이 접두사를 붙이지 않습니다.

### 만드는 방법

**① 앱: `apps/mobile/.env.local`** (새 파일)

`apps/mobile/.env.example`을 복사해 이름을 `.env.local`로 바꾸고 빈칸을 채웁니다.

```
EXPO_PUBLIC_API_BASE_URL=http://localhost:8000
EXPO_PUBLIC_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxx
```

- `EXPO_PUBLIC_API_BASE_URL`: 분석 서버 주소. 이 PC에서 돌리면 그대로 둡니다.
- 두 Supabase 값이 비어 있으면 앱은 로그인 없이 분석만 하고, 로그인·관심 판매처 저장 버튼이 보이지 않습니다.

**② 서버: `apps/api/.env`** (이미 있는 파일에 두 줄 추가)

```
SUPABASE_URL=https://abcdefghijklmnop.supabase.co
SUPABASE_SECRET_KEY=sb_secret_xxxxxxxxxxxx
```

이 두 줄은 회원 탈퇴에만 쓰입니다. 비어 있으면 탈퇴 버튼이 "계정을 삭제하지 못했어요"로 실패하고, 나머지 기능은 그대로 동작합니다. 같은 파일의 다른 값(분석용)은 그대로 둡니다.

| 기존 값 | 쓰임 |
| --- | --- |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | 상품 정보 추출, 판매 설명 검토, 캡처 글자 읽기 |
| `SERPER_API_KEY` | 공식 사이트 검색, 쇼핑 시세 검색 |
| `DATA_GO_KR_SERVICE_KEY` | 국세청 사업자 상태, 공정위 통신판매업 신고 조회 |
| `SAFEPICK_RATE_LIMIT_PER_MINUTE` | 한 사용자(IP)의 분당 분석 요청 수 제한 (기본 30) |

**작성 규칙**: `이름=값` 한 줄에 하나, `=` 앞뒤에 띄어쓰기와 따옴표 없이 씁니다. `#`으로 시작하는 줄은 설명(주석)입니다.

### 바꾼 뒤에는 다시 시작

환경 변수는 프로그램이 **시작할 때 한 번** 읽습니다. 값을 넣거나 바꾼 뒤에는:

- 앱: 개발 서버를 끄고 `apps/mobile`에서 `npx expo start --web --clear` (앱에서는 값이 빌드에 박히므로 `--clear`로 캐시를 지워야 새 값이 들어갑니다)
- 서버: `apps/api`에서 uvicorn을 껐다가 다시 실행

### 잘 들어갔는지 확인

- 앱 첫 화면 오른쪽 위에 **로그인** 버튼이 보이면 앱 쪽 값이 들어간 것입니다. 버튼이 없으면 `.env.local`의 Supabase 값이 비었거나, 파일 이름·위치(`apps/mobile/.env.local`)가 다르거나, 앱을 `--clear`로 다시 시작하지 않은 것입니다. (주소창에 `/sign-in`을 직접 넣으면 "로그인 설정이 아직 없어요"로도 확인할 수 있습니다.)
- 회원 탈퇴가 실패하면 `apps/api/.env`의 두 값과 서버 재시작을 확인합니다.

## 4. 확인

- 브라우저 테스트(가짜 Supabase, 실제 계정 불필요): `web-fake-auth` 서버(포트 8082, `.claude/launch.json`)를 켠 뒤 `node tests/account-ui.cjs`. 카카오 로그인 → 분석 기록 자동 저장 → 관심 판매처 저장 → 마이페이지 새로고침 → 닉네임 변경 → 회원 탈퇴까지 확인합니다.
- API 테스트: `apps/api`에서 `python -m pytest tests/test_accounts.py`.
- 실제 카카오·Google 로그인은 위 1~3단계를 마친 뒤 직접 확인해야 합니다.

## 한계

- 휴대폰 앱의 로그인(`expo-web-browser`로 브라우저를 열고 `safepick://sign-in`으로 돌아오는 방식)은 코드만 있고 개발 빌드에서 확인하지 않았습니다.
- 분석 기록은 최근 100개까지 보여 줍니다. 기록과 관심 판매처의 결과는 저장한 날 기준이라 판매 페이지가 바뀌었을 수 있습니다.
