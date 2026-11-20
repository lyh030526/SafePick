from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


def test_web_app_pages_fall_back_to_the_single_page_index():
    for path in ("/", "/browse", "/history"):
        response = client.get(path)
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/html")


def test_api_routes_still_answer_before_the_web_app():
    assert client.get("/health").json() == {"status": "ok"}


def test_files_outside_the_web_build_are_never_served():
    for path in ("/../main.py", "/%2e%2e/main.py", "/..%2fmain.py", "/web/../main.py"):
        response = client.get(path)
        assert b"FastAPI" not in response.content
        assert b"OPENAI" not in response.content
