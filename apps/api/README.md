# SafePick API

## 실행

```powershell
py -m uvicorn main:app --reload --port 8000
```

## 환경 변수

`.env.example`을 `.env`로 복사한 뒤 `OPENAI_API_KEY`를 설정하면 자동 추출을 사용합니다. 기본 OpenAI 주소가 아닌 엔드포인트를 사용할 경우 `OPENAI_BASE_URL`에 해당 주소를 설정하고, 그 엔드포인트에서 지원하는 모델을 `OPENAI_MODEL`에 입력합니다. 키가 없으면 모든 추출 항목은 `확인 불가`로 반환되어 앱에서 직접 보정할 수 있습니다.

공식 사이트 검색은 [Serper](https://serper.dev/)의 Google Search API를 사용합니다. `SERPER_API_KEY`를 설정하면 지원 브랜드의 공식 도메인으로만 결과를 검색합니다. 키가 없거나 검색 요청이 실패한 경우에도 분석은 완료되고, 검색을 사용할 수 없다는 안내를 반환합니다.

## 현재 API

- `GET /health`: 서버 상태를 확인합니다.
- `GET /brands`: 초기 지원 브랜드와 공식 도메인 목록을 반환합니다.
- `POST /analyses`: 공개 상품 페이지의 텍스트를 수집하고 상품 정보를 구조화합니다.

`POST /analyses`는 추출된 브랜드가 지원 대상인지 확인하고, LLM이 만든 브랜드·모델 기반 검색어로 공식 도메인만 검색합니다. 검색 결과는 `official_lookup`에 담깁니다. 내부망·로컬 주소와 HTML이 아닌 응답은 차단합니다. 페이지에서 읽은 공개 텍스트만 OpenAI에 전달하며, 결과가 없는 필드는 `확인 불가`로 처리합니다.
