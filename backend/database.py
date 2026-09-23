"""
SQLite 데이터베이스 설정 및 사용자 모델
"""
import sqlite3
import hashlib
import os
from pathlib import Path

DB_PATH = Path(__file__).parent / "ccatfarm.db"


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """테이블 생성 (users + detections)"""
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS detections (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            source          TEXT NOT NULL DEFAULT 'pipeline',
            source_key      TEXT UNIQUE,
            status          TEXT NOT NULL,
            zone            TEXT DEFAULT 'Unknown',
            camera          TEXT DEFAULT '',
            run_id          TEXT DEFAULT '',
            capture_date    TEXT DEFAULT '',
            mission_id      TEXT DEFAULT '',
            capture_id      TEXT DEFAULT '',
            pose_x          REAL,
            pose_y          REAL,
            pose_yaw        REAL,
            pose_source     TEXT DEFAULT '',
            robot_pose      TEXT DEFAULT '',
            conditions      TEXT NOT NULL DEFAULT '[]',
            overall         TEXT DEFAULT '',
            recommendation  TEXT DEFAULT '',
            inference_ms    REAL DEFAULT 0,
            detection_count INTEGER DEFAULT 0,
            class_counts    TEXT DEFAULT '{}',
            original_path   TEXT DEFAULT '',
            annotated_path  TEXT DEFAULT '',
            captured_at     TEXT DEFAULT '',
            analyzed_at     TEXT NOT NULL,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_detections_status ON detections(status)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_detections_source ON detections(source)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_detections_analyzed_at ON detections(analyzed_at DESC)"
    )
    conn.commit()
    conn.close()


def insert_detection(record: dict) -> int | None:
    """source_key 기준 멱등 INSERT.

    Preconditions:
    - record는 detection 정보를 담은 dict. 필수/선택 컬럼이 일부 누락되어도
      아래에서 스키마 기본값으로 채워 KeyError 없이 바인딩한다.
    Postconditions:
    - source_key가 신규면 INSERT 후 새 행의 id(lastrowid)를 반환한다.
    - source_key가 UNIQUE 제약을 위반(중복)하면 INSERT를 건너뛰고 None을 반환한다(멱등 스킵).
    """
    # 스키마 컬럼별 기본값으로 정규화하여 named-parameter 바인딩 시 누락 키 방지
    params = {
        "source": record.get("source", "pipeline"),
        "source_key": record.get("source_key"),
        "status": record.get("status", "Abnormal"),
        "zone": record.get("zone", "Unknown"),
        "camera": record.get("camera", ""),
        "run_id": record.get("run_id", ""),
        "capture_date": record.get("capture_date", ""),
        "mission_id": record.get("mission_id", ""),
        "capture_id": record.get("capture_id", ""),
        "pose_x": record.get("pose_x"),
        "pose_y": record.get("pose_y"),
        "pose_yaw": record.get("pose_yaw"),
        "pose_source": record.get("pose_source", ""),
        "robot_pose": record.get("robot_pose", ""),
        "conditions": record.get("conditions", "[]"),
        "overall": record.get("overall", ""),
        "recommendation": record.get("recommendation", ""),
        "inference_ms": record.get("inference_ms", 0),
        "detection_count": record.get("detection_count", 0),
        "class_counts": record.get("class_counts", "{}"),
        "original_path": record.get("original_path", ""),
        "annotated_path": record.get("annotated_path", ""),
        "captured_at": record.get("captured_at", ""),
        "analyzed_at": record.get("analyzed_at", ""),
    }
    conn = get_db()
    try:
        cur = conn.execute(
            """
            INSERT INTO detections
              (source, source_key, status, zone, camera, run_id, capture_date,
               mission_id, capture_id, pose_x, pose_y, pose_yaw, pose_source, robot_pose,
               conditions, overall, recommendation, inference_ms, detection_count,
               class_counts, original_path, annotated_path, captured_at, analyzed_at)
            VALUES (:source, :source_key, :status, :zone, :camera, :run_id, :capture_date,
               :mission_id, :capture_id, :pose_x, :pose_y, :pose_yaw, :pose_source, :robot_pose,
               :conditions, :overall, :recommendation, :inference_ms, :detection_count,
               :class_counts, :original_path, :annotated_path, :captured_at, :analyzed_at)
            """,
            params,
        )
        conn.commit()
        return cur.lastrowid
    except sqlite3.IntegrityError:  # UNIQUE(source_key) 충돌 → 멱등 스킵
        return None
    finally:
        conn.close()


def list_detections(status: str = "All", zone: str = "",
                    source: str = "", limit: int = 100) -> list[dict]:
    """detection 목록을 필터/정렬/개수 제한하여 조회한다.

    Preconditions:
    - status/zone/source는 필터 값. status == "All"이면 status 필터를 건너뛰고,
      zone/source가 빈 문자열("")이면 각 필터를 건너뛴다.
    - limit는 반환 개수 상한(정수로 처리).
    Postconditions:
    - 지정한 필터를 모두 만족하는 detection을 analyzed_at DESC 정렬로 반환한다.
    - 반환 개수는 limit 이하이며, 각 항목은 sqlite3.Row를 변환한 dict이다.
    """
    # 파라미터 바인딩으로 WHERE 절을 동적 구성 (SQL 인젝션 방지)
    clauses: list[str] = []
    params: list = []
    if status != "All":
        clauses.append("status = ?")
        params.append(status)
    if zone != "":
        clauses.append("zone = ?")
        params.append(zone)
    if source != "":
        clauses.append("source = ?")
        params.append(source)

    sql = "SELECT * FROM detections"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY analyzed_at DESC LIMIT ?"
    params.append(int(limit))

    conn = get_db()
    try:
        rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def get_detection(detection_id) -> dict | None:
    """id로 단일 detection을 조회한다. 없으면 None을 반환한다."""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM detections WHERE id = ?",
            (detection_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def detection_exists(source_key: str) -> bool:
    """source_key를 가진 detection이 존재하면 True, 아니면 False를 반환한다."""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT 1 FROM detections WHERE source_key = ? LIMIT 1",
            (source_key,),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def hash_password(password: str) -> str:
    salt = os.environ.get("PASSWORD_SALT", "ccatfarm2024")
    return hashlib.sha256(f"{password}{salt}".encode()).hexdigest()


def create_user(username: str, password: str, name: str = "") -> dict | None:
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, name) VALUES (?, ?, ?)",
            (username, hash_password(password), name)
        )
        conn.commit()
        user = conn.execute(
            "SELECT id, username, name FROM users WHERE username = ?",
            (username,)
        ).fetchone()
        return dict(user) if user else None
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()


def verify_user(username: str, password: str) -> dict | None:
    conn = get_db()
    user = conn.execute(
        "SELECT id, username, name, password_hash FROM users WHERE username = ?",
        (username,)
    ).fetchone()
    conn.close()
    if not user:
        return None
    if user["password_hash"] != hash_password(password):
        return None
    return {"id": user["id"], "username": user["username"], "name": user["name"]}


# 앱 시작 시 DB 초기화
init_db()
