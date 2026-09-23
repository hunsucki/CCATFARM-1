from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks, WebSocket, WebSocketDisconnect, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import asyncio
import json
import os
import subprocess
import time
import logging
import yaml
from collections import Counter
from pathlib import Path
from uuid import uuid4
from dotenv import load_dotenv

load_dotenv()

from database import (
    create_user,
    verify_user,
    init_db,
    insert_detection,
    get_detection,
    detection_exists,
    list_detections,
)
from auth import create_token, verify_token
from gemini_analyzer import analyze_image_bytes

log = logging.getLogger(__name__)

# ── 추론 실행 구성 (환경변수) ──
# NOTE: task 12.1에서 정식으로 finalize 예정. 여기서는 합리적 기본값으로 로드한다.
INFERENCE_PYTHON = os.environ.get("INFERENCE_PYTHON", "/home/user/torch_env/bin/python")
INFERENCE_SCRIPT = os.environ.get("INFERENCE_SCRIPT", "/home/user/pipeline-server/run-inference.py")
INFERENCE_TIMEOUT = float(os.environ.get("INFERENCE_TIMEOUT", "30"))
# TensorRT 엔진 경로. 백엔드가 직접 사용하지는 않지만(run-inference.py가 사용),
# 디커플링을 위해 백엔드에서 환경변수로 로드하여 추론 subprocess 환경으로 전달한다.
ENGINE_PATH = os.environ.get("ENGINE_PATH", "/home/user/model/model_jetson_fp16.engine")
# anomaly_results 루트 (fallback 재동기화 스캔 대상). task 12.1에서 정식으로 finalize 예정.
ANOMALY_DIR = Path(os.environ.get("ANOMALY_DIR", "/home/user/anomaly_results"))
# capture 루트 (zone별 집계용 metadata.yaml 스캔 대상). task 12.1에서 정식으로 finalize 예정.
CAPTURE_DIR = Path(os.environ.get("CAPTURE_DIR", "/home/user/capture"))
# 훅 공유 시크릿. 설정 시 /api/hook/* 엔드포인트에서 X-Hook-Token 헤더를 검증한다.
# 빈 문자열/미설정이면 검증을 생략한다(개방, 하위 호환). task 12.1에서 정식으로 finalize 예정.
HOOK_TOKEN = os.environ.get("HOOK_TOKEN", "")


def verify_hook_token(x_hook_token: str | None):
    """훅 공유 시크릿(X-Hook-Token) 검증.

    HOOK_TOKEN 환경변수가 설정된 경우에만 X-Hook-Token 헤더가 일치하는지 확인하고,
    불일치(또는 헤더 부재) 시 401을 발생시킨다. HOOK_TOKEN이 비어 있으면(미설정)
    검증을 생략하여 하위 호환(개방)을 유지한다. side effect 없음.
    """
    if HOOK_TOKEN and x_hook_token != HOOK_TOKEN:
        raise HTTPException(status_code=401, detail="유효하지 않은 훅 토큰입니다.")


def is_allowed_path(path) -> bool:
    """정규화된 경로가 CAPTURE_DIR 또는 ANOMALY_DIR 하위인 경우에만 True를 반환한다.

    경로 탈출(`../`) 시도를 방지하기 위한 화이트리스트 검증이다.

    Preconditions:
    - path는 str 또는 Path (또는 os.fspath 가능한 값).
    Postconditions:
    - Path(path).resolve()로 정규화한 경로가 CAPTURE_DIR 또는 ANOMALY_DIR의
      resolve() 결과 하위(또는 동일)이면 True, 그 외에는 False.
    - resolve()는 strict=False(기본)이므로 존재하지 않는 경로도 `..`를 정규화한다.
      예: `/home/user/capture/../../etc/passwd` → `/etc/passwd` → 컨테인먼트 실패 → False.
    - 정규화 자체가 실패(OSError/ValueError)하면 False.
    - side effect 없음.
    """
    try:
        resolved = Path(path).resolve()
    except (OSError, ValueError):
        return False
    roots = [CAPTURE_DIR.resolve(), ANOMALY_DIR.resolve()]
    for root in roots:
        try:
            resolved.relative_to(root)
            return True
        except ValueError:
            continue
    return False


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


# ── Pipeline Hook Models ──
class CaptureHook(BaseModel):
    path: str
    camera: str = ""
    run_id: str = ""
    date: str = ""
    hostname: str = ""


class SyncRequest(BaseModel):
    date: str = ""


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


def detection_to_crop(row: dict) -> dict:
    """DB detections 행을 프론트 CropResult 형태의 dict로 직렬화한다.

    Preconditions:
    - row는 list_detections/get_detection이 반환한 detections 테이블 행 dict.
    Postconditions:
    - CropResult 스키마(id/source/zone/status/conditions/overall/recommendation/
      filename/analyzed_at/annotationUrl/camera/runId/missionId/captureId/capturedAt/pose)에
      맞는 dict를 반환한다. side effect 없음.
    - conditions는 JSON TEXT를 파싱하며, 파싱 실패 시 []로 폴백한다(방어적).
    - pose는 pose_x와 pose_y가 모두 존재할 때만 {x,y,yaw,source}로 구성하고,
      그 외에는 None으로 둔다(좌표 재계산 없음).
    - annotationUrl은 annotated_path가 있을 때만 /api/annotations/{id}로 채우고, 없으면 None.
    """
    # conditions: JSON TEXT → list (파싱 실패 시 [])
    try:
        conditions = json.loads(row.get("conditions") or "[]")
    except (json.JSONDecodeError, TypeError):
        conditions = []

    # filename: 원본 경로의 basename
    original_path = row.get("original_path") or ""
    filename = Path(original_path).name if original_path else ""

    # annotationUrl: annotated_path가 있을 때만 서빙 URL 구성
    annotated_path = row.get("annotated_path") or ""
    annotation_url = f"/api/annotations/{row['id']}" if annotated_path else None

    # pose: pose_x/pose_y가 모두 존재할 때만 구성
    pose_x = row.get("pose_x")
    pose_y = row.get("pose_y")
    if pose_x is not None and pose_y is not None:
        pose = {
            "x": pose_x,
            "y": pose_y,
            "yaw": row.get("pose_yaw"),
            "source": row.get("pose_source", "") or "",
        }
    else:
        pose = None

    return {
        "id": row.get("id"),
        "source": row.get("source"),
        "zone": row.get("zone"),
        "status": row.get("status"),
        "conditions": conditions,
        "overall": row.get("overall", "") or "",
        "recommendation": row.get("recommendation", "") or "",
        "filename": filename,
        "analyzed_at": row.get("analyzed_at", "") or "",
        "annotationUrl": annotation_url,
        "camera": row.get("camera", "") or "",
        "runId": row.get("run_id", "") or "",
        "missionId": row.get("mission_id", "") or "",
        "captureId": row.get("capture_id", "") or "",
        "capturedAt": row.get("captured_at", "") or "",
        "pose": pose,
    }


@app.get("/api/crops")
def get_crops(status: str = "All", zone: str = "", limit: int = 100):
    """저장된 detection 목록 조회 (DB 기반, TensorRT 단일 경로).

    status/zone/limit로 필터링하며, source="pipeline"을 강제하여
    반환되는 모든 detection이 파이프라인 경로 결과임을 보장한다(단일 경로 불변식).
    """
    rows = list_detections(status=status, zone=zone, source="pipeline", limit=limit)
    crops = [detection_to_crop(r) for r in rows]
    return {"crops": crops, "total": len(crops)}


@app.get("/api/annotations/{detection_id}")
def get_annotation(detection_id: int):
    """detection의 어노테이션(바운딩박스) 이미지를 image/jpeg로 서빙한다.

    - `get_detection`으로 조회 후 `annotated_path`가 화이트리스트(CAPTURE_DIR/ANOMALY_DIR)
      하위이고 파일이 존재하면 스트리밍한다.
    - detection이 없거나 annotated_path가 비었거나 화이트리스트 밖이거나 디스크에 파일이
      없으면 404를 반환한다(파일 존재 여부를 누출하지 않기 위해 403 대신 404로 통일).
    """
    det = get_detection(detection_id)
    if not det:
        raise HTTPException(status_code=404, detail="detection을 찾을 수 없습니다.")
    annotated_path = det.get("annotated_path") or ""
    if (not annotated_path
            or not is_allowed_path(annotated_path)
            or not Path(annotated_path).is_file()):
        raise HTTPException(status_code=404, detail="어노테이션 이미지를 찾을 수 없습니다.")
    return FileResponse(annotated_path, media_type="image/jpeg")


# ── WebSocket 실시간 브로드캐스트 (연결 관리) ──
# 활성 WebSocket 연결 집합. 연결 시 등록, 해제 시 제거한다.
active_connections: set[WebSocket] = set()

# 메인 이벤트 루프 참조. 동기 백그라운드 작업(run_inference_job)이 task 7.2에서
# 이 루프로 브로드캐스트를 스케줄링할 수 있도록 startup 시점에 캡처한다.
MAIN_EVENT_LOOP: asyncio.AbstractEventLoop | None = None


@app.websocket("/ws/detections")
async def ws_detections(websocket: WebSocket):
    """신규 detection 실시간 수신용 WebSocket 엔드포인트.

    - 연결 수립 시 active_connections에 등록한다.
    - 인바운드 메시지는 기대하지 않으며, 연결 유지를 위해 수신만 대기한다.
    - 연결 종료(정상 disconnect 또는 기타 예외) 시 active_connections에서 제거한다.
    """
    await websocket.accept()
    active_connections.add(websocket)
    try:
        while True:
            # 연결 유지 목적. 인바운드 메시지는 사용하지 않는다.
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.discard(websocket)
    except Exception:
        active_connections.discard(websocket)


@app.on_event("startup")
async def _capture_loop():
    """실행 중인 메인 이벤트 루프 참조를 캡처한다.

    동기 백그라운드 작업(run_inference_job)이 task 7.2에서 브로드캐스트를
    이 루프로 스케줄링할 수 있도록 startup 시점에 루프 참조를 저장한다.
    (기존 _boot_sync startup 핸들러와 병행 실행된다.)
    """
    global MAIN_EVENT_LOOP
    MAIN_EVENT_LOOP = asyncio.get_running_loop()


# ── 파이프라인 캡처 훅 ──
RESULT_JSON_PREFIX = "RESULT_JSON:"


def parse_result_json(stdout: str) -> dict | None:
    """추론 stdout에서 마지막 `RESULT_JSON:` 라인을 파싱하여 결과 dict를 반환한다.

    Loop Invariant: 마지막 RESULT_JSON 라인이 최종 결과.
    - 여러 라인 중 `RESULT_JSON:` 프리픽스로 시작하는 마지막 라인의 payload를 추적한다.
    - RESULT_JSON 라인이 하나도 없으면 None을 반환한다.
    - 마지막 RESULT_JSON payload 파싱에 실패하면(JSONDecodeError) None을 반환한다.
    """
    if not stdout:
        return None

    last_payload: str | None = None
    for line in stdout.splitlines():
        if line.startswith(RESULT_JSON_PREFIX):
            last_payload = line[len(RESULT_JSON_PREFIX):]

    if last_payload is None:
        return None

    try:
        return json.loads(last_payload)
    except json.JSONDecodeError:
        return None


def zone_id_to_label(zone_id) -> str:
    """단문자 zone_id를 표시 라벨로 변환한다. 알 수 없으면 'Unknown'. 좌표 재계산 안 함.

    - "A" → "Zone A", "B" → "Zone B"
    - None/빈값 → "Unknown"
    """
    if not zone_id:
        return "Unknown"
    return f"Zone {zone_id}"


def extract_zone_fields(record: dict) -> dict:
    """meta.json 기반 레코드에서 zone/pose/capture 메타 필드를 추출한다.

    Preconditions: record는 meta.json 기반 결과 레코드. capture_metadata는 있을 수도, 없을 수도 있음.
    Postconditions:
    - capture_metadata.capture.zone_id가 있으면 zone은 zone_id_to_label(zone_id)
    - robot_pose가 있으면 pose_x/pose_y/pose_yaw/pose_source를 채우고 원본 pose를 robot_pose(JSON)로 보존
    - capture_metadata 누락(구버전/미매칭)이면 zone="Unknown", pose_* = None, 나머지는 빈 문자열
    - 어떤 경우에도 zone을 좌표로 재계산하지 않음
    """
    cm = record.get("capture_metadata")
    if not cm:
        return {"zone": "Unknown", "mission_id": "", "capture_id": "", "captured_at": "",
                "pose_x": None, "pose_y": None, "pose_yaw": None, "pose_source": "",
                "robot_pose": ""}
    cap = cm.get("capture", {}) or {}
    pose = cap.get("robot_pose") or {}
    return {
        "zone": zone_id_to_label(cap.get("zone_id")),
        "mission_id": cm.get("mission_id", "") or "",
        "capture_id": str(cap.get("capture_id", "")),
        "captured_at": cap.get("captured_at", "") or "",
        "pose_x": pose.get("x"), "pose_y": pose.get("y"),
        "pose_yaw": pose.get("yaw"), "pose_source": pose.get("source", "") or "",
        "robot_pose": json.dumps(pose) if pose else "",
    }


def resolve_camera(record: dict, hook_camera: str) -> str:
    """camera 판정: 소스 경로의 left/right 폴더명을 capture_metadata.camera보다 우선.

    데이터 품질 이슈(좌/우가 동일 capture_id 공유) 대응을 위해 실제 이미지 소스 경로를
    우선 사용하고, 경로에서 판정 불가할 때만 훅 값(hook_camera)으로 폴백한다.
    """
    src = record.get("source", "") or ""
    parts = Path(src).parts
    if "left" in parts:
        return "left"
    if "right" in parts:
        return "right"
    return hook_camera


async def _broadcast_async(payload: dict):
    """연결된 모든 WebSocket 클라이언트에 payload를 전송한다.

    개별 클라이언트 전송이 실패하면 그 연결만 dead로 모아 두었다가 제거하고,
    나머지 클라이언트로의 전송은 계속한다(부분 실패 격리).
    """
    dead = []
    for ws in list(active_connections):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        active_connections.discard(ws)


def broadcast_detection(record):
    """detection을 CropResult로 직렬화하여 모든 WS 클라이언트에 푸시한다.

    동기 백그라운드 작업(run_inference_job)에서 호출되므로, 실제 async 전송은
    메인 이벤트 루프(MAIN_EVENT_LOOP)로 스레드-세이프하게 스케줄링한다.

    Preconditions: record는 get_detection이 반환한 detections 행 dict(또는 None/빈값).
    Postconditions:
    - record가 비었으면 아무 것도 하지 않는다.
    - detection_to_crop 직렬화 실패 시 경고 로깅 후 스킵(작업 중단 없음).
    - 이벤트 루프가 준비되지 않았으면 스킵(디버그 로깅).
    - 준비되었으면 _broadcast_async를 run_coroutine_threadsafe로 루프에 위임한다.
    """
    if not record:
        return
    try:
        payload = detection_to_crop(record)
    except Exception as e:
        log.warning("broadcast 직렬화 실패: %s", e)
        return
    loop = MAIN_EVENT_LOOP
    if loop is None:
        log.debug("이벤트 루프 미준비 — 브로드캐스트 스킵")
        return
    try:
        # 동기 백그라운드-작업 스레드에서 이벤트 루프로 스레드-세이프 스케줄링
        asyncio.run_coroutine_threadsafe(_broadcast_async(payload), loop)
    except Exception as e:
        log.warning("broadcast 스케줄링 실패: %s", e)


def run_inference_job(req: CaptureHook, job_id: str):
    """추론 subprocess 실행 → 이상 결과 DB 저장 (백그라운드 작업).

    Preconditions: INFERENCE_PYTHON, INFERENCE_SCRIPT가 설정되어 있고 req.path가 접근 가능.
    Postconditions:
    - 추론 subprocess를 실행하고, 이상(Abnormal) 결과만 Detection_Store에 멱등 INSERT한다.
    - returncode != 0, timeout, 예외 발생 시 오류를 로깅하고 DB에 저장하지 않는다.
    - 정상(Normal)/파싱 실패/None 결과는 DB에 저장하지 않는다.
    - 신규 id가 INSERT되면 후속 브로드캐스트 훅을 호출한다(실패해도 작업을 막지 않음).
    """
    try:
        proc = subprocess.run(
            [INFERENCE_PYTHON, INFERENCE_SCRIPT, "--input", req.path, "--json"],
            capture_output=True, text=True, timeout=INFERENCE_TIMEOUT,
            # ENGINE_PATH를 subprocess 환경으로 전달 → run-inference.py가 env에서 읽어 사용.
            # ANOMALY_DIR도 함께 전달하여 파이프라인/백엔드 경로 구성을 일관되게 유지한다.
            env={**os.environ, "ENGINE_PATH": ENGINE_PATH, "ANOMALY_DIR": str(ANOMALY_DIR)},
        )
    except subprocess.TimeoutExpired:
        log.error("추론 타임아웃 job=%s path=%s (timeout=%ss)", job_id, req.path, INFERENCE_TIMEOUT)
        return
    except Exception as e:  # subprocess 실행 자체가 실패한 경우 (실행파일 부재 등)
        log.error("추론 실행 오류 job=%s path=%s: %s", job_id, req.path, e)
        return

    if proc.returncode != 0:
        log.error("추론 실패 job=%s: %s", job_id, (proc.stderr or "")[-500:])
        return

    record = parse_result_json(proc.stdout)
    if record is None or record.get("status") != "Abnormal":
        return  # 정상은 파일 삭제됨, DB 미기록

    # zone/pose는 meta.json의 capture_metadata에서 추출 (좌표 재계산 없음)
    zone_fields = extract_zone_fields(record)

    # conditions/class_counts는 DB에 TEXT(JSON)로 저장되므로 직렬화
    record["conditions"] = json.dumps(record.get("conditions", []), ensure_ascii=False)
    record["class_counts"] = json.dumps(record.get("class_counts", {}), ensure_ascii=False)

    record.update(
        source="pipeline",
        run_id=req.run_id,
        capture_date=req.date,
        camera=resolve_camera(record, req.camera),
        source_key=record.get("annotated_path", ""),
        original_path=record.get("source", ""),
        analyzed_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
        **zone_fields,
    )

    new_id = insert_detection(record)  # 멱등
    if new_id is not None:
        try:
            broadcast_detection(get_detection(new_id))
        except Exception as e:  # 브로드캐스트 실패가 작업을 중단시키지 않도록 방어
            log.warning("broadcast_detection 실패 job=%s id=%s: %s", job_id, new_id, e)


def meta_to_record(meta: dict, source_key: str) -> dict:
    """anomaly_results의 meta.json을 DB 레코드로 변환한다 (fallback 재동기화용).

    훅 경로(run_inference_job)와 완전히 동일한 매핑 + extract_zone_fields/resolve_camera
    규칙을 적용하여, sync로 들어온 결과와 훅으로 들어온 결과가 동일한 스키마를 갖도록 한다.

    Preconditions:
    - meta는 run-inference.py `_save_result`가 저장한 meta.json을 파싱한 dict.
      (source, annotated, inference_ms, detection_count, class_counts, detections,
       capture_metadata 키를 가질 수 있으며, 누락 시 방어적으로 기본값을 사용한다.)
    - source_key는 이 detection의 멱등키 (일반적으로 meta["annotated"]).
    Postconditions:
    - status는 항상 "Abnormal" (anomaly_results/에는 이상 결과만 저장되므로).
    - source="pipeline", source_key는 전달된 값.
    - bbox는 box_yxyx_normalized([ymin,xmin,ymax,xmax]) → {x,y,w,h}(정규화)로 변환.
    - zone/pose/camera는 extract_zone_fields/resolve_camera로 훅 경로와 동일하게 파생.
    - side effect 없음.
    """
    # detections → conditions 변환 (build_result_record와 동일한 bbox 변환 규칙)
    conditions = []
    for det in meta.get("detections", []) or []:
        box = det.get("box_yxyx_normalized")
        bbox = None
        if box and len(box) == 4:
            ymin, xmin, ymax, xmax = box
            bbox = {
                "x": xmin,
                "y": ymin,
                "w": xmax - xmin,
                "h": ymax - ymin,
            }
        conditions.append({
            "type":        det.get("class_name"),
            "confidence":  det.get("confidence"),
            "description": det.get("recommendation"),
            "bbox":        bbox,
        })

    cm = meta.get("capture_metadata") or {}

    record = {
        "status":          "Abnormal",
        "source":          "pipeline",
        "source_key":      source_key,
        "annotated_path":  meta.get("annotated", "") or "",
        "original_path":   meta.get("source", "") or "",
        "inference_ms":    meta.get("inference_ms", 0),
        "detection_count": meta.get("detection_count", 0),
        "class_counts":    json.dumps(meta.get("class_counts", {}) or {}, ensure_ascii=False),
        "conditions":      json.dumps(conditions, ensure_ascii=False),
        "analyzed_at":     time.strftime("%Y-%m-%dT%H:%M:%S"),
        "run_id":          cm.get("run_id", "") or "",
        "capture_date":    cm.get("date", "") or "",
    }

    # zone/pose는 capture_metadata에서만 파생 (좌표 재계산 없음).
    # meta는 이미 capture_metadata/source 키를 가지므로 그대로 전달할 수 있다.
    zone_fields = extract_zone_fields(meta)
    # sync 경로에는 훅 페이로드가 없으므로 camera 폴백은 capture_metadata.camera 값을 사용한다.
    camera = resolve_camera(meta, cm.get("camera", "") or "")
    record["camera"] = camera
    record.update(**zone_fields)

    return record


def sync_from_filesystem(anomaly_dir) -> dict:
    """anomaly_results/를 재귀 스캔하여 DB에 없는 meta.json을 멱등 INSERT한다 (fallback 재동기화).

    Preconditions:
    - anomaly_dir는 str 또는 Path. anomaly_results/ 루트 경로.
    Postconditions:
    - anomaly_dir 하위 모든 `*_meta.json`을 rglob으로 재귀 스캔한다.
    - source_key = meta["annotated"] or str(meta_path) 기준으로 멱등 처리:
      이미 존재하면 skipped++, 없으면 meta_to_record → insert_detection 후 성공 시 synced++.
    - JSON/OSError 파싱 실패 파일은 skip 후 다음 파일로 계속한다.
    - anomaly_dir이 존재하지 않으면 {"synced": 0, "skipped": 0}을 반환한다.
    Loop Invariant: 처리된 meta는 source_key로 멱등 보장, 중복은 skip.
    """
    anomaly_dir = Path(anomaly_dir)
    if not anomaly_dir.exists():
        return {"synced": 0, "skipped": 0}

    synced, skipped = 0, 0
    for meta_path in anomaly_dir.rglob("*_meta.json"):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        source_key = meta.get("annotated") or str(meta_path)
        if detection_exists(source_key):
            skipped += 1
            continue
        record = meta_to_record(meta, source_key)
        if insert_detection(record) is not None:
            synced += 1
    return {"synced": synced, "skipped": skipped}


# ── Zone별 집계 서비스 (요청 시 실시간 metadata.yaml 스캔) ──
def scan_zone_captures(capture_dir) -> dict:
    """capture 루트 하위의 모든 metadata.yaml을 요청 시 실시간 스캔하여 zone별 집계 원시값 반환.

    사용자 확정 스코프대로 사전 집계 캐시를 쓰지 않고, 호출 시점에 매번
    `capture_dir.rglob("metadata.yaml")`로 모든 run의 metadata.yaml을 직접 로드한다.

    Preconditions:
    - capture_dir는 str 또는 Path. capture/ 루트 경로.
    Postconditions:
    - 반환값은 raw zone_id("A","B" 등)를 키로 하는 dict이며,
      값은 {"capture_count": int, "image_count": int}.
      * capture_count = zone별 고유 촬영 건수. captures[]의 각 항목(하나의 capture_id)을
        1건으로 계수한다(좌/우 동일 capture_id는 1건, partial_pair도 1건).
      * image_count = 실제 이미지 파일 참조 개수(files dict의 truthy 값 개수 합).
        좌+우 = 2, 한쪽만 = 1. 촬영 건수와 별도 필드로 제공한다(Requirement 9.6).
    - capture_dir이 존재하지 않으면 {} 반환.
    - 파싱 불가(YAML/OSError)한 metadata.yaml은 skip → 그 파일에 속한 zone은
      총 촬영 수 집계에서 제외된다(Requirement 10.3). 처리 가능한 파일은 계속 처리한다.
    - zone_id가 없는(falsy) capture는 어느 zone도 부풀리지 않도록 skip한다.
    - 좌표(zone_config)로 zone을 재계산하지 않는다. metadata의 zone_id만 신뢰의 원천.
    Loop Invariant: (meta_path, capture_id)로 중복 계수를 방지한다.
    """
    capture_dir = Path(capture_dir)
    if not capture_dir.exists():
        return {}

    zones: dict[str, dict] = {}
    seen: set[tuple[str, object]] = set()  # (meta_path, capture_id) 중복 계수 방지

    for meta_path in capture_dir.rglob("metadata.yaml"):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except (yaml.YAMLError, json.JSONDecodeError, OSError):
            # 접근/파싱 불가 파일은 skip → 해당 zone은 총 촬영 수 집계에서 제외
            continue
        if not isinstance(data, dict):
            continue

        meta_key = str(meta_path)
        for cap in data.get("captures", []) or []:
            if not isinstance(cap, dict):
                continue
            zone_id = cap.get("zone_id")
            if not zone_id:
                # zone 미상 capture는 어느 zone도 부풀리지 않도록 제외
                continue

            capture_id = cap.get("capture_id")
            dedup = (meta_key, capture_id)
            if dedup in seen:
                continue
            seen.add(dedup)

            bucket = zones.setdefault(zone_id, {"capture_count": 0, "image_count": 0})
            # 촬영 요청 단위 = capture_id → 항목 1개 = 촬영 1건 (좌/우 1건, partial도 1건)
            bucket["capture_count"] += 1
            # 이미지 장수 = 실제 이미지 파일 참조 개수 (left+right=2, 한쪽만=1)
            files = cap.get("files") or {}
            if isinstance(files, dict):
                bucket["image_count"] += sum(1 for v in files.values() if v)

    return zones


def build_zone_summary(capture_dir=CAPTURE_DIR) -> list[dict]:
    """zone별 {total, normal, abnormal, image_count} 요약 리스트를 조립한다.

    총 촬영 수(total)/이미지 장수(image_count)는 metadata.yaml 실시간 스캔(scan_zone_captures),
    이상 수(abnormal)는 Detection_Store의 Abnormal pipeline detection을 zone 라벨 기준으로 집계한다.

    Preconditions:
    - capture_dir는 str 또는 Path. capture/ 루트 경로.
    Postconditions:
    - scan_zone_captures는 RAW zone_id("A","B")로 키가 매겨지고, Detection_Store의 zone은
      LABEL("Zone A")로 저장되므로, RAW zone_id는 zone_id_to_label로 LABEL로 변환해 정렬한다.
    - 각 항목: {"zone": label, "total": int, "normal": int, "abnormal": int, "image_count": int}.
      * total = 해당 zone의 capture_count (metadata 접근 불가 zone은 캡처 집계에서 제외 → 0).
      * abnormal = 해당 zone LABEL의 Abnormal detection 개수.
      * normal = max(total - abnormal, 0) — metadata 접근 불가(total=0)여도 abnormal은 계속 보고,
        정상 수는 음수가 되지 않도록 0으로 클램프한다(Requirement 10.3).
      * image_count = 해당 zone의 실제 이미지 파일 개수.
    - 두 소스(캡처/detection)의 zone 합집합을 구성한다: 캡처만 있는 zone과 detection만 있는
      zone(metadata 누락/접근 불가) 모두 결과에 포함된다.
    - detection만 있는 zone(캡처 데이터 없음)은 total=0, image_count=0, abnormal=해당 개수, normal=0.
    - 데이터가 전혀 없는 zone은 자연스럽게 결과에 나타나지 않는다(0으로 채워질 대상이 없음).
    - side effect 없음(DB 읽기 전용 조회).
    """
    raw_counts = scan_zone_captures(capture_dir)

    # Abnormal pipeline detection을 zone LABEL 기준으로 집계.
    # detections 테이블은 zone을 LABEL("Zone A")로 저장한다(run_inference_job이
    # extract_zone_fields→zone_id_to_label을 적용하기 때문).
    detections = list_detections(status="Abnormal", source="pipeline", limit=1_000_000)
    abnormal_by_label = Counter(d.get("zone") for d in detections)

    summary: list[dict] = []
    seen_labels: set[str] = set()

    # 1) 캡처 데이터가 있는 zone (RAW zone_id → LABEL 변환)
    for zone_id, counts in raw_counts.items():
        label = zone_id_to_label(zone_id)
        seen_labels.add(label)
        total = counts.get("capture_count", 0)
        image_count = counts.get("image_count", 0)
        abnormal = abnormal_by_label.get(label, 0)
        normal = max(total - abnormal, 0)
        summary.append({
            "zone": label,
            "total": total,
            "normal": normal,
            "abnormal": abnormal,
            "image_count": image_count,
        })

    # 2) detection만 있고 캡처 metadata가 없는 zone (metadata 접근 불가/누락).
    #    총 촬영 수에서는 제외(total=0)하되 Detection_Store 기준 이상 수는 계속 제공(Req 10.3).
    for label, abnormal in abnormal_by_label.items():
        if label in seen_labels:
            continue
        summary.append({
            "zone": label,
            "total": 0,
            "normal": 0,
            "abnormal": abnormal,
            "image_count": 0,
        })

    return summary


@app.post("/api/hook/capture", status_code=202)
async def hook_capture(req: CaptureHook, background: BackgroundTasks,
                       x_hook_token: str | None = Header(default=None)):
    """watchdog 캡처 훅 수신 → 즉시 202 반환, 추론은 백그라운드로 위임(비블로킹).

    보안:
    - HOOK_TOKEN 설정 시 X-Hook-Token 공유 시크릿을 먼저 검증한다(불일치 시 401).
      미인증 호출자가 경로 처리 이전에 거부되도록 토큰 검증을 최우선으로 수행한다.
    - req.path가 CAPTURE_DIR/ANOMALY_DIR 화이트리스트 하위인지 검증하여
      경로 탈출 시도를 차단한다(위반 시 403). 검증을 통과한 경로만 추론 대상으로 위임한다.
    """
    verify_hook_token(x_hook_token)
    if not is_allowed_path(req.path):
        raise HTTPException(status_code=403, detail="허용되지 않은 경로입니다.")
    job_id = uuid4().hex
    background.add_task(run_inference_job, req, job_id)
    return {"job_id": job_id, "accepted": True}


@app.post("/api/hook/sync")
def hook_sync(req: SyncRequest | None = None,
              x_hook_token: str | None = Header(default=None)):
    """anomaly_results fallback 재동기화 트리거.

    보안: HOOK_TOKEN 설정 시 X-Hook-Token 공유 시크릿을 먼저 검증한다(불일치 시 401).

    본문 없이 호출하면 ANOMALY_DIR 전체를 스캔한다. `{date}`가 주어지면
    ANOMALY_DIR/<date> 하위만 스캔하여 범위를 한정한다.
    처리 요약 `{synced, skipped}`를 반환한다.
    """
    verify_hook_token(x_hook_token)
    target = ANOMALY_DIR
    if req and req.date:
        target = ANOMALY_DIR / req.date
    return sync_from_filesystem(target)


@app.get("/api/zones/summary")
def zones_summary():
    """zone별 {total, normal, abnormal, image_count} 요약 배열을 반환한다.

    build_zone_summary()가 metadata.yaml 실시간 스캔 + Detection_Store를 조합해
    zone별 요약 리스트를 조립하며(캐시 미사용), 프론트 소비 편의를 위해
    `{"zones": [...]}` 형태로 감싸 반환한다.
    """
    return {"zones": build_zone_summary()}


@app.on_event("startup")
def _boot_sync():
    """부팅 시 anomaly_results를 1회 자동 스캔하여 누락된 결과를 재동기화한다.

    스캔 실패가 서버 기동을 막지 않도록 try/except로 감싼다(best-effort).
    """
    try:
        result = sync_from_filesystem(ANOMALY_DIR)
        log.info("부팅 스캔 재동기화 완료: %s", result)
    except Exception as e:
        log.warning("부팅 스캔 실패: %s", e)


@app.get("/api/data")
def get_data():
    return {"items": ["Perilla Leaf A", "Perilla Leaf B", "Sensor Data 01"]}
