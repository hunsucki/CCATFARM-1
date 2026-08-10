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

응답 형식:
{
  "status": "Normal" 또는 "Abnormal",
  "conditions": [
    {
      "type": "normal" | "chlorosis" | "insect_hole",
      "confidence": "high" | "medium" | "low",
      "description": "한국어로 간단한 설명"
    }
  ],
  "overall": "한국어로 종합 소견 한 문장"
}

- 정상이면 status는 "Normal", conditions에 type:"normal" 하나만.
- 이상 있으면 status는 "Abnormal", 해당 증상들을 conditions에 나열.
- 같은 증상이 여러 곳이면 개수를 description에 포함 (예: "충공 3곳 발견").
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

        response = requests.post(GEMINI_URL, json=payload, headers=headers, timeout=30)

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
