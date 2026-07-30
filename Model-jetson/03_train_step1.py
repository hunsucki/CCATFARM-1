"""
Step 3-1: 1차 추가학습 (155305 모델 + ccat 24장 원본만)

Colab에서 실행:
  !python CCATFARM/Model-jetson/03_train_step1.py \
    --model /content/drive/MyDrive/CCATFARM_data/yolo11m_seg_aug_20260707_155305_best.pt \
    --dataset /content/dataset_all \
    --output /content/runs
"""
import shutil
import random
import argparse
from pathlib import Path
from ultralytics import YOLO


def prepare_ccat_dataset(dataset_dir):
    """ccat 24장만 따로 train/val 분할해서 학습 데이터 준비"""
    ccat_list_file = dataset_dir / "ccat_images_list.txt"
    orig_images = dataset_dir / "original" / "images"
    orig_labels = dataset_dir / "original" / "labels"

    # ccat 이미지 목록 읽기
    with open(ccat_list_file, "r") as f:
        ccat_names = [line.strip() for line in f if line.strip()]

    # ccat 전용 데이터셋 폴더 생성
    step1_dir = dataset_dir / "step1_ccat"
    step1_train_img = step1_dir / "train" / "images"
    step1_train_lbl = step1_dir / "train" / "labels"
    step1_val_img = step1_dir / "val" / "images"
    step1_val_lbl = step1_dir / "val" / "labels"

    step1_train_img.mkdir(parents=True, exist_ok=True)
    step1_train_lbl.mkdir(parents=True, exist_ok=True)
    step1_val_img.mkdir(parents=True, exist_ok=True)
    step1_val_lbl.mkdir(parents=True, exist_ok=True)

    # 80/20 분할
    random.seed(42)
    random.shuffle(ccat_names)
    val_count = max(1, int(len(ccat_names) * 0.2))
    val_names = ccat_names[:val_count]
    train_names = ccat_names[val_count:]

    for name in train_names:
        stem = Path(name).stem
        img_src = orig_images / name
        lbl_src = orig_labels / (stem + ".txt")
        if img_src.exists():
            shutil.copy2(img_src, step1_train_img / name)
        if lbl_src.exists():
            shutil.copy2(lbl_src, step1_train_lbl / (stem + ".txt"))

    for name in val_names:
        stem = Path(name).stem
        img_src = orig_images / name
        lbl_src = orig_labels / (stem + ".txt")
        if img_src.exists():
            shutil.copy2(img_src, step1_val_img / name)
        if lbl_src.exists():
            shutil.copy2(lbl_src, step1_val_lbl / (stem + ".txt"))

    # data.yaml 생성
    yaml_content = f"""path: {step1_dir.resolve()}
train: train/images
val: val/images

names:
  0: leaf
  1: chlorosis
  2: insect_hole
"""
    yaml_path = step1_dir / "data.yaml"
    with open(yaml_path, "w") as f:
        f.write(yaml_content)

    print(f"[Step1 데이터 준비]")
    print(f"  Train: {len(train_names)}장")
    print(f"  Val: {len(val_names)}장")
    print(f"  data.yaml: {yaml_path}")

    return yaml_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, required=True, help="155305 모델 파일 경로")
    parser.add_argument("--dataset", type=str, required=True, help="dataset_all 폴더 경로")
    parser.add_argument("--output", type=str, required=True, help="출력(runs) 폴더 경로")
    args = parser.parse_args()

    model_path = Path(args.model)
    dataset_dir = Path(args.dataset)
    output_dir = Path(args.output)

    print("=" * 50)
    print("[1차 추가학습] 155305 모델 + ccat 24장")
    print("=" * 50)

    # ccat 데이터 준비
    data_yaml = prepare_ccat_dataset(dataset_dir)

    # 모델 로드 & 학습
    model = YOLO(str(model_path))

    results = model.train(
        data=str(data_yaml),
        epochs=50,
        imgsz=640,
        batch=8,
        patience=15,
        save=True,
        project=str(output_dir),
        name="step1_ccat_finetune",
        exist_ok=True,
        lr0=0.001,
        lrf=0.01,
        warmup_epochs=3,
        mosaic=0.5,
        workers=2,
        seed=42,
    )

    # 결과
    best_pt = output_dir / "step1_ccat_finetune" / "weights" / "best.pt"
    print("=" * 50)
    print(f"[1차 학습 완료] → {best_pt}")
    print("이 모델을 2차 학습(03_train_step2.py)의 base로 사용합니다.")


if __name__ == "__main__":
    main()
