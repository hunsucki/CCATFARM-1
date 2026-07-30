"""
Step 3-2: 2차 추가학습 (1차 모델 + 원본+증강 전체 데이터)

Colab에서 실행:
  !python CCATFARM/Model-jetson/03_train_step2.py \
    --model /content/runs/step1_ccat_finetune/weights/best.pt \
    --dataset /content/dataset_all \
    --output /content/runs
"""
import argparse
from pathlib import Path
from ultralytics import YOLO


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, required=True, help="1차 학습 모델 (step1_best.pt)")
    parser.add_argument("--dataset", type=str, required=True, help="dataset_all 폴더 경로")
    parser.add_argument("--output", type=str, required=True, help="출력(runs) 폴더 경로")
    args = parser.parse_args()

    model_path = Path(args.model)
    dataset_dir = Path(args.dataset)
    output_dir = Path(args.output)
    data_yaml = dataset_dir / "data.yaml"

    print("=" * 50)
    print("[2차 추가학습] 1차 모델 + 전체 데이터(원본+증강)")
    print(f"  Base 모델: {model_path}")
    print(f"  데이터: {data_yaml}")
    print("=" * 50)

    if not model_path.exists():
        print(f"[ERROR] 1차 모델 파일 없음: {model_path}")
        print("  먼저 03_train_step1.py를 실행하세요.")
        return

    if not data_yaml.exists():
        print(f"[ERROR] data.yaml 없음: {data_yaml}")
        print("  먼저 02_augment_dataset.py를 실행하세요.")
        return

    model = YOLO(str(model_path))

    results = model.train(
        data=str(data_yaml),
        epochs=100,
        imgsz=640,
        batch=8,
        patience=20,
        save=True,
        save_period=10,
        project=str(output_dir),
        name="step2_full_finetune",
        exist_ok=True,
        lr0=0.0005,       # 2차라 lr 더 낮게
        lrf=0.01,
        warmup_epochs=3,
        mosaic=0.5,
        mixup=0.1,
        workers=2,
        seed=42,
    )

    best_pt = output_dir / "step2_full_finetune" / "weights" / "best.pt"
    print("=" * 50)
    print(f"[2차 학습 완료] 최종 모델 → {best_pt}")


if __name__ == "__main__":
    main()
