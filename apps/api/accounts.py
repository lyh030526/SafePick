"""Account deletion. Sign-in, profiles, history and saved listings live in Supabase and are reached by the app directly
under row level security; only deleting the sign-in itself needs the project's secret key, which stays on this server."""
import os

import httpx
from fastapi import Header, HTTPException


def delete_account(authorization: str = Header(default="")) -> dict[str, str]:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    secret = os.getenv("SUPABASE_SECRET_KEY", "").strip()
    if not url or not secret:
        raise HTTPException(status_code=503, detail="계정 삭제 설정이 아직 없습니다.")
    token = authorization.removeprefix("Bearer ").strip()
    if not token or token == authorization:
        raise HTTPException(status_code=401, detail="로그인 정보가 없습니다.")
    try:
        # The token is checked by Supabase itself, so a forged or expired one never names a user to delete.
        user = httpx.get(f"{url}/auth/v1/user", headers={"apikey": secret, "Authorization": f"Bearer {token}"}, timeout=10.0)
        if user.status_code in {401, 403}:
            raise HTTPException(status_code=401, detail="로그인이 만료되었습니다. 다시 로그인해 주세요.")
        user.raise_for_status()
        user_id = user.json()["id"]
        # Profiles, history and saved listings reference the user with ON DELETE CASCADE, so they go with it.
        deleted = httpx.delete(f"{url}/auth/v1/admin/users/{user_id}",
                               headers={"apikey": secret, "Authorization": f"Bearer {secret}"}, timeout=10.0)
        deleted.raise_for_status()
    except HTTPException:
        raise
    except (httpx.HTTPError, KeyError, ValueError):
        raise HTTPException(status_code=502, detail="계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.") from None
    return {"status": "deleted"}
