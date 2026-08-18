"""
Gemini Vision API를 이용한 작물 상태 분석 모듈 (REST API 직접 호출)
"""
import base64
import json
import os
import requests
from pathlib import Path

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY 환경변수를 설정하세요.")

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"

ANALYSIS_PROMPT = """
당신은 작물 병해 진단 전문가입니다.
이 깻잎(들깻잎) 이미지를 분석해서 아래 JSON 형식으로만 응답하세요.
다른 텍스트 없이 순수 JSON만 반환하세요.

판단 기준:
- "normal": 건강한 녹색 잎, 이상 없음
- "chlorosis": 잎이 노랗게 변색됨 (황화 현상)
- "insect_hole": 벌레가 먹어서 구멍이 뚫린 상태

신뢰도는 0.0~1.0 사이 소수로 표시하세요.
이상 부위의 대략적 위치를 bbox로 표시하세요 (이미지 기준 0.0~1.0 비율).
bbox는 해당 이상 영역을 넉넉하게 감싸도록 잡아주세요.

응답 형식:
{
  "status": "Normal" 또는 "Abnormal",
  "conditions": [
    {
      "type": "normal" | "chlorosis" | "insect_hole",
      "confidence": 0.0~1.0,
      "severity": "high" | "medium" | "low",
      "description": "한국어로 간단한 설명",
      "bbox": {"x": 0.1, "y": 0.2, "w": 0.4, "h": 0.4}
    }
  ],
  "overall": "한국어로 종합 소견 한 문장",
  "recommendation": "한국어로 조치 권장사항 2~3문장"
}

- 정상이면 status는 "Normal", conditions에 type:"normal" 하나만 (bbox 생략).
- 이상 있으면 status는 "Abnormal", 이상 있는 잎 각각에 대해 개별 항목으로 나열.
- 절대 여러 잎을 하나의 bbox로 합치지 마세요. 각 잎마다 따로 bbox를 잡으세요.
- 한 잎에 여러 증상이 있으면 같은 bbox로 증상별 항목을 각각 만드세요.
- severity: confidence 0.8 이상이면 high, 0.5~0.8이면 medium, 0.5 미만이면 low.
- recommendation: 정상이면 "현재 상태를 유지하세요.", 이상이면 구체적 조치 방안 제시.
"""


def analyze_image_bytes(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """이미지 바이트를 받아서 Gemini로 분석 (REST API)"""
    try:
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": ANALYSIS_PROMPT},
                        {
                            "inline_data": {
                                "mime_type": mime_type,
                                "data": image_b64
                            }
                        }
                    ]
                }
            ]
        }

        headers = {
            "Content-Type": "application/json",
            "X-goog-api-key": GEMINI_API_KEY,
        }

        response = requests.post(GEMINI_URL, json=payload, headers=headers, timeout=60)

        if response.status_code != 200:
            return {
                "status": "Error",
                "conditions": [],
                "overall": f"API 오류 ({response.status_code}): {response.text[:200]}"
            }

        data = response.json()

        # 응답에서 텍스트 추출
        text = data["candidates"][0]["content"]["parts"][0]["text"].strip()

        # ```json ... ``` 감싸져 있을 경우 처리
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            text = text.rsplit("```", 1)[0]

        result = json.loads(text)
        return result

    except json.JSONDecodeError:
        return {
            "status": "Error",
            "conditions": [],
            "overall": f"분석 결과 파싱 실패: {text[:200]}"
        }
    except Exception as e:
        return {
            "status": "Error",
            "conditions": [],
            "overall": f"분석 실패: {str(e)}"
        }


def analyze_image_file(file_path: str) -> dict:
    """파일 경로로 분석"""
    path = Path(file_path)
    suffix = path.suffix.lower()
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
    mime_type = mime_map.get(suffix, "image/jpeg")

    with open(path, "rb") as f:
        image_bytes = f.read()

    return analyze_image_bytes(image_bytes, mime_type)
