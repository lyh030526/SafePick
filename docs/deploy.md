# 배포

## 1. 분석 서버 (Render 무료 요금제)

저장소 루트의 [`render.yaml`](../render.yaml)이 서버 설정입니다. Render가 이 파일을 읽어 `apps/api`를 설치하고 실행합니다.

### 무료 요금제에서 알아 둘 것

- 15분 동안 요청이 없으면 서버가 잠들고, 그다음 첫 분석은 깨어나는 데 **30~60초** 더 걸립니다. 앱의 분석 대기 시간(150초) 안이라 실패하지는 않습니다.
- 디스크가 없어서 공정위 통신판매사업자 색인(`data/mail_order/index.sqlite`, 338MB)이 없습니다. 이 색인은 네이버·11번가처럼 사업자번호를 숨기는 곳에서 상호·대표자로 번호를 찾는 보조 단계라, 없으면 그 단계만 건너뜁니다. 쿠팡처럼 번호가 보이는 곳은 영향이 없습니다.
- 서버가 다시 시작되면 요청 제한 기록과 조회 결과 기억(하루)이 비워집니다.
- OpenAI·Serper 사용료는 배포 위치와 상관없이 쓴 만큼 듭니다.

### 순서

1. **코드를 GitHub에 올립니다.** Render는 GitHub 저장소에서 코드를 가져옵니다(`develop` 브랜치).
2. [render.com](https://render.com)에 **GitHub 계정으로 가입**하고, Render가 `SafePick` 저장소를 읽도록 허용합니다.
3. 대시보드에서 **New → Blueprint**를 누르고 `SafePick` 저장소와 **`develop` 브랜치**를 고릅니다. `render.yaml`을 찾아 `safepick-api` 서비스(Free)를 보여 줍니다.
4. 값을 넣으라는 칸이 나오면 `apps/api/.env`에 있는 값을 그대로 붙여 넣습니다. 이 값들은 Render에만 저장되고 저장소에는 들어가지 않습니다.

   | 칸 | 넣을 값 |
   | --- | --- |
   | `OPENAI_API_KEY` | OpenAI 키 |
   | `SERPER_API_KEY` | Serper 키 |
   | `DATA_GO_KR_SERVICE_KEY` | 공공데이터포털 키 |
   | `SUPABASE_URL` | `https://<프로젝트>.supabase.co` |
   | `SUPABASE_SECRET_KEY` | Supabase 비밀 키(`sb_secret_...`) |
   | `SAFEPICK_ALLOWED_ORIGINS` | 웹 앱 주소. 웹을 아직 안 올렸으면 비워 두고(로컬 주소만 허용), 웹을 올린 뒤 그 주소를 넣습니다 |

5. **Apply**를 누르면 설치와 실행이 시작됩니다(몇 분). 끝나면 서비스 주소가 생깁니다. 예: `https://safepick-api.onrender.com`
6. 브라우저로 `https://safepick-api.onrender.com/health`를 열어 `{"status":"ok"}`가 나오면 성공입니다.

`develop`에 새 커밋을 올리면 Render가 자동으로 다시 배포합니다(`autoDeploy: true`).

### 앱을 배포된 서버에 연결

로컬 앱으로 먼저 확인하려면 `apps/mobile/.env.local`의 `EXPO_PUBLIC_API_BASE_URL`을 Render 주소로 바꾸고 앱을 `--clear`로 다시 시작합니다. 이때 로컬 웹(`http://localhost:8081`)에서 접속하므로 `SAFEPICK_ALLOWED_ORIGINS`는 비워 두거나 `http://localhost:8081`을 포함해야 합니다.

### 문제가 생기면

| 증상 | 확인할 것 |
| --- | --- |
| 배포가 실패함 | Render 서비스의 **Logs**. 설치 단계 오류면 `requirements.txt`, 실행 단계 오류면 환경 변수 |
| `/health`는 되는데 앱에서 "Failed to fetch" | `SAFEPICK_ALLOWED_ORIGINS`에 앱 주소가 없음, 또는 앱의 `EXPO_PUBLIC_API_BASE_URL`이 Render 주소가 아님 |
| 분석 결과에 "AI 설정이 없어" | Render의 `OPENAI_API_KEY`가 비어 있음 |
| 첫 분석만 유난히 느림 | 무료 요금제가 잠들었다가 깨어난 것(정상) |

## 2. 휴대폰에서 시험 (Expo Go)

1. 휴대폰에 **Expo Go**를 설치하고, PC와 **같은 와이파이**에 연결합니다.
2. PC에서 분석 서버를 네트워크용으로 켭니다: `.claude/launch.json`의 `api-lan`(또는 `apps/api`에서 `python -m uvicorn main:app --host 0.0.0.0 --port 8000`).
3. `apps/mobile/.env.local`의 `EXPO_PUBLIC_API_BASE_URL`을 PC의 와이파이 주소로 둡니다(예: `http://192.168.219.111:8000`). PC 주소는 PowerShell `ipconfig`의 Wi-Fi IPv4 주소입니다.
4. 앱 개발 서버(`npx expo start --clear`)를 켜고, Expo Go에서 QR을 찍거나 **Enter URL manually**에 `exp://<PC 주소>:8081`을 넣습니다.
5. 휴대폰에서 연결이 안 되면 Windows 방화벽이 Python·Node의 접속을 막는 경우가 많습니다. 처음 실행할 때 뜨는 방화벽 창에서 **개인 네트워크 허용**을 누릅니다.
6. Expo Go 안에서 로그인하려면 Supabase **Authentication → URL Configuration → Redirect URLs**에 `exp://**`를 추가합니다(개발용, 출시 전 삭제). 로그인 없이도 분석은 됩니다.

첫 화면의 **쿠팡 열기**로 앱 안에서 쿠팡을 열고, 상품 페이지에서 **이 페이지 분석**을 누르면 확장 프로그램과 같은 수집 코드로 판매자 정보·배송·반품·상품 문의를 읽어 분석 화면으로 가져옵니다. 쿠팡 휴대폰 화면은 PC와 구조가 달라 실제 휴대폰에서 판매자 정보가 잘 읽히는지 확인이 필요합니다. 수집 코드를 고치면 `apps/mobile`에서 `npm run sync-collector`로 앱용 사본을 다시 만듭니다(`tests/inapp-collector.cjs`가 사본이 최신인지 확인).

### 쿠팡 링크를 복사해 가져오기
쿠팡 앱 상품 화면에서 **공유 → 링크 복사** 후 SafePick의 **복사한 링크 붙여넣기**를 누르면, 앱 안 브라우저가 그 상품 페이지를 열고 다 뜨면 저절로 읽어 분석 화면에 채웁니다. 상품 링크 칸에 쿠팡 링크를 넣고 **분석 시작**을 눌러도 같습니다(휴대폰 앱에서만. 웹은 서버가 링크를 읽습니다).

## 3. 안드로이드 앱(APK) — 쿠팡 앱에서 공유로 보내기

쿠팡 앱 상품 화면의 **공유 → SafePick**으로 바로 분석하려면 SafePick이 휴대폰의 공유 목록에 있어야 합니다. 이건 **Expo Go로는 안 되고** 앱을 빌드해 설치해야 합니다. 설정은 `apps/mobile/app.json`(`expo-share-intent`, 패키지 이름 `com.safepick.app`)과 `apps/mobile/eas.json`(`preview` = 설치용 APK)에 있습니다.

1. [expo.dev](https://expo.dev)에 가입합니다(무료).
2. `apps/mobile`에서 로그인하고 프로젝트를 연결합니다. 처음 한 번만 하면 됩니다.
   ```bash
   npx eas-cli@latest login
   ```
   ```bash
   npx eas-cli@latest init
   ```
   `init`은 `app.json`에 프로젝트 ID(`extra.eas.projectId`)를 넣습니다.
3. 앱이 쓸 값을 EAS에 넣습니다. `.env.local`은 빌드 서버로 올라가지 않기 때문입니다. 값은 `.env.local`과 같고, `preview` 환경에 넣습니다.
   ```bash
   npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_API_BASE_URL --value https://safepick-api.onrender.com --visibility plaintext
   ```
   ```bash
   npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://<프로젝트>.supabase.co --visibility plaintext
   ```
   ```bash
   npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value sb_publishable_... --visibility plaintext
   ```
   분석 서버를 아직 Render에 안 올렸다면 PC 주소(`http://192.168.219.111:8000`)를 넣어도 되지만, 그 APK는 PC가 켜져 있고 같은 와이파이일 때만 분석됩니다. 안드로이드는 기본으로 `http://` 주소 접속을 막으므로 PC 주소로 시험하려면 따로 허용이 필요합니다. Render(`https://`)를 권장합니다.
4. APK를 빌드합니다(10~20분, 무료 요금제는 대기 시간이 더 걸릴 수 있음).
   ```bash
   npx eas-cli@latest build --platform android --profile preview
   ```
   처음에는 앱 서명 키를 만들지 묻습니다. **Yes**를 누르면 EAS가 만들고 보관합니다.
5. 끝나면 나오는 링크(또는 QR)를 휴대폰에서 열어 APK를 내려받아 설치합니다. 안드로이드가 "출처를 알 수 없는 앱" 설치를 물으면 그 브라우저에 한해 허용합니다.
6. 로그인을 쓰려면 Supabase **Authentication → URL Configuration → Redirect URLs**에 `safepick://**`를 추가합니다(설치한 앱은 `safepick://sign-in`으로 돌아옵니다).

설치 후 쿠팡 앱 상품 화면에서 **공유**를 누르고 목록에서 **SafePick**을 고르면, SafePick이 열리며 그 상품 페이지를 앱 안에서 읽고 분석 화면으로 갑니다. 쿠팡이 아닌 링크를 공유하면 상품 링크 칸에 채워집니다. iOS 공유는 아직 꺼 두었습니다(`disableIOS`).

## 4. 다음 단계

- 웹 앱 배포(Expo 무료 호스팅)와 그 주소를 카카오·Google·Supabase 로그인 설정에 추가
- 안드로이드 앱 빌드(EAS)와 휴대폰 시험
- 개인정보처리방침·이용약관 화면, 플레이스토어 등록
