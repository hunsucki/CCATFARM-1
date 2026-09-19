from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import time
from dotenv import load_dotenv

load_dotenv()

from database import create_user, verify_user, init_db
from auth import create_token, verify_token
from gemini_analyzer import analyze_image_bytes

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# DB 초기화
init_db()


# ── Auth Models ──
class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str
    name: str = ""


# ── Auth Endpoints ──
@app.post("/api/auth/login")
def login(req: LoginRequest):
    user = verify_user(req.username, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다.")
    token = create_token(user["id"], user["username"])
    return {"token": token, "user": user}


@app.post("/api/auth/register")
def register(req: RegisterRequest):
    user = create_user(req.username, req.password, req.name)
    if not user:
        raise HTTPException(status_code=409, detail="이미 존재하는 아이디입니다.")
    token = create_token(user["id"], user["username"])
    return {"token": token, "user": user}


@app.get("/api/auth/me")
def get_me(authorization: str = ""):
    """토큰 검증 → 사용자 정보 반환"""
    token = authorization.replace("Bearer ", "") if authorization else ""
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="인증이 필요합니다.")
    return {"user_id": payload["user_id"], "username": payload["username"]}

@app.get("/")
def root():
    return {"message": "CCATFARM API가 정상 작동 중입니다!"}


# ── 작물 분석 (Gemini Vision) ──
crop_results: list[dict] = []  # 메모리 저장 (나중에 DB로 전환 가능)


@app.post("/api/crops/analyze")
async def analyze_crop(file: UploadFile = File(...), zone: str = "Unknown"):
    """이미지 업로드 → Gemini로 분석 → 결과 반환"""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="이미지 파일만 업로드 가능합니다.")

    image_bytes = await file.read()
    mime_type = file.content_type or "image/jpeg"

    result = analyze_image_bytes(image_bytes, mime_type)
    result["zone"] = zone
    result["filename"] = file.filename
    result["analyzed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    # 이미지를 base64로 포함
    import base64
    result["imageData"] = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode()}"

    # 결과 저장
    crop_results.insert(0, result)
    # 최대 100개만 유지
    if len(crop_results) > 100:
        crop_results.pop()

    return result


@app.get("/api/crops")
def get_crops(status: str = "All", zone: str = ""):
    """저장된 분석 결과 목록 조회"""
    filtered = crop_results
    if status != "All":
        filtered = [c for c in filtered if c.get("status") == status]
    if zone:
        filtered = [c for c in filtered if c.get("zone") == zone]
    return {"crops": filtered, "total": len(filtered)}


@app.get("/api/data")
def get_data():
    return {"items": ["Perilla Leaf A", "Perilla Leaf B", "Sensor Data 01"]}
