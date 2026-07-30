"""
Step 4: 최종 모델 테스트

Colab에서 실행:
  !python CCATFARM/Model-jetson/04_test.py \
    --model /content/runs/step2_full_finetune/weights/best.pt \
    --dataset /content/dataset_all \
    --output /content/runs
"""
import argparse
from pathlib import Path
from ultralytics import YOLO


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, required=True, help="테스트할 모델 경로")
    parser.add_argument("--dataset", type=str, required=True, help="dataset_all 폴더 경로")
    parser.add_argument("--output", type=str, required=True, help="출력(runs) 폴더 경로")
    args = parser.parse_args()

    model_path = Path(args.model)
    dataset_dir = Path(args.dataset)
    output_dir = Path(args.output)
    data_yaml = dataset_dir / "data.yaml"
    val_images = dataset_dir / "val" / "images"

    print("=" * 50)
    print("[모델 테스트]")
    print(f"  모델: {model_path}")

    if not model_path.exists():
        print(f"[ERROR] 모델 파일 없음: {model_path}")
        return

    model = YOLO(str(model_path))

    # Validation 평가
    print("\n[1] Validation Set 평가")
    metrics = model.val(data=str(data_yaml))
    print(f"  mAP@50: {metrics.seg.map50:.4f}")
    print(f"  mAP@50-95: {metrics.seg.map:.4f}")

    # 시각적 예측
    print(f"\n[2] Val 이미지 예측 시각화")
    results = model.predict(
        source=str(val_images),
        save=True,
        conf=0.5,
        project=str(output_dir),
        name="test_results",
        exist_ok=True,
    )
    print(f"  결과 저장: {output_dir}/test_results/")
    print("=" * 50)
    print("[테스트 완료]")


if __name__ == "__main__":
    main()
