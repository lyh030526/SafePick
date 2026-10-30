# 텍스트·이미지 입력 및 브라우저 확장 검증

검증일: 2026-10-28 (한국 시간)

## 구현 범위

- 기존 링크 분석 유지, 상품 설명 붙여넣기, 상품 이미지 첨부·미리보기·삭제·AI 전송 동의.
- 텍스트 또는 이미지가 있으면 해당 자료로 추출하고 판매 페이지 직접 수집은 생략. 공식 검색·비교와 보정 입력은 기존 경로에 연결.
- 이미지 입력: JPG/PNG/WebP, 최대 3장, 장당 4MB·총 8MB. 파일 실체와 해상도 검사, 요청 본문 12MB 제한, 오류 응답에서 원본 자료 제외.
- 원문·이미지는 운영 API에서 디스크나 DB에 저장하지 않으며, 사용자 제공 자료와 서버 직접 수집 자료를 화면에서 구분.
- Manifest V3 확장: 사용자 클릭에 따른 현재 네이버 상품 페이지 읽기, 공개 텍스트와 상품 JSON-LD 추출, 편집 미리보기, 로컬 앱으로 전달. 계정·쿠키·내부 API·차단 우회 기능 없음.
- 상품 URL의 옵션 쿼리를 보존. 수집 시각은 사용자 기기 기준이며 데이터와 URL의 일치 여부를 인증하지 않음.

## 검증 결과

| 검증 | 결과 | 범위 |
| --- | --- | --- |
| Python unittest | 37개 통과 | 기존 30개와 제공 자료 관련 7개 |
| TypeScript | 통과 | `npx tsc --noEmit` |
| ESLint | 통과 | `npm run lint` |
| 기존 UI 회귀 | 통과 | 390px/1440px, 비교 상태·가격·출처·재비교·오류 재시도 |
| 설치된 확장과 앱 통합 | 통과 | 격리된 Edge 프로필에 확장을 CDP로 로드하고 실제 action으로 activeTab 부여 |
| 새 입력 UI | 통과 | 390px/1440px, 이미지 선택·미리보기·요청 데이터·삭제·재동의·링크만 분석·가로 넘침 없음 |
| 잘못된 확장 입력 | 통과 | 오류 안내, URL fragment 제거, 브라우저 실행 오류 없음 |
| 실제 OpenAI 이미지 추출 | 통과 | 가상 상품 이미지 1장과 빈 이미지 1장, 기본 설정 모델 사용 |

확장 UI는 실제 action 권한 부여 후 **설치된 popup 문서를 테스트 탭으로 열어** 검증합니다. 읽기·전송은 실제 `chrome.scripting`/`chrome.tabs` API를 사용하며, 네이버 URL에는 가상 상품 fixture를 응답합니다. 실제 네이버 서버를 크롤링한 테스트가 아닙니다.

실제 OpenAI 검증에서는 설명 텍스트 없이 이미지의 `DemoBrand`, `SP-TEST-100`, `129,000 KRW`, `데모스토어`, 구성품을 추출했습니다. 빈 이미지에서는 브랜드·상품명·모델·가격·판매자를 `확인 불가`로 반환했습니다. 이 가상 상품은 실제 판매 정보나 가격의 근거가 아닙니다.

검증 자료: [가상 상품 이미지](validation/2026-10-28/material-input/synthetic-product.png), [실제 이미지 분석 응답](validation/2026-10-28/material-input/live-image-results.json).

## 실행 방법

API 폴더에서:

```cmd
python -m unittest discover -s tests -v
```

모바일 폴더에서:

```cmd
npx tsc --noEmit
npm run lint
node tests/week4-ui.cjs
node tests/material-ui.cjs
```

UI 테스트는 Playwright가 필요합니다. 별도 설치 경로를 쓸 경우 `PLAYWRIGHT_MODULE`에 모듈 경로를 지정합니다. 확장 테스트는 최신 브라우저의 `Extensions.loadUnpacked`/`triggerAction` CDP 기능을 사용합니다. 이 환경에서는 `TEST_BROWSER_CHANNEL=msedge`로 검증했습니다. 기본값은 테스트용 `chromium`입니다. 앱은 8081번 포트에서 실행되어야 하며 UI 테스트의 분석 응답은 모킹합니다.

실제 모델 재검증은 `python tests/live_material.py`로 실행하며 기존 OpenAI API 비용이 발생합니다. 테스트는 합성 이미지로 한정합니다.

## 남은 제한

추가 실제 검증: [컬리N마트 네이버 쇼핑 상품 페이지](validation/2026-10-28/naver-window-product/README.md)에서 확장 수집과 실제 AI 추출에 성공했습니다. 해당 테스트 이후 `shopping.naver.com/window-products/...` 주소 지원을 추가했습니다.

- 실제 네이버 운영 페이지의 마크업별 호환성·접근 성공률은 별도 확인이 필요합니다. 검색 결과/가격비교 화면은 지원하지 않습니다.
- 차단·로그인·CAPTCHA를 우회하지 않습니다. 브라우저 권한과 사용자 동작은 서비스의 데이터 이용 허락을 대체하지 않습니다.
- iOS/Android 실기기 검증과 Chrome Web Store 배포는 하지 않았습니다. 현재 확장은 PC 로컬 개발용입니다.
- 이미지의 작은 글자·옵션·할인 조건은 오독할 수 있습니다. 결과를 확인·보정해야 하며, 정품 또는 판매자 신뢰도를 인증하지 않습니다.
