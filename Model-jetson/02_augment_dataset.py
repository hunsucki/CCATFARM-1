"""
Step 2: 원본 데이터 기반 증강 (5배)
- dataset_all/original → 증강 → dataset_all/augmented
- train/val 분할 생성
- data.yaml 생성

Colab에서 실행:
  !python CCATFARM/Model-jetson/02_augment_dataset.py --dataset /content/dataset_all
"""
import cv2
import numpy as np
import albumentations as A
from pathlib import Path
import random
import shutil
import argparse

AUG_MULTIPLIER = 5

transform = A.Compose([
    A.HorizontalFlip(p=0.5),
    A.VerticalFlip(p=0.2),
    A.RandomRotate90(p=0.3),
    A.Rotate(limit=15, p=0.4, border_mode=cv2.BORDER_REFLECT),
    A.RandomBrightnessContrast(brightness_limit=0.1, contrast_limit=0.1, p=0.3),
    A.HueSaturationValue(hue_shift_limit=5, sat_shift_limit=10, val_shift_limit=10, p=0.3),
    A.RandomScale(scale_limit=0.2, p=0.3),
])


def parse_yolo_seg_label(label_path, img_w, img_h):
    polygons = []
    class_ids = []

    if not label_path.exists():
        return polygons, class_ids

    with open(label_path, "r") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 7:
                continue
            class_id = int(parts[0])
            coords = list(map(float, parts[1:]))
            points = []
            for i in range(0, len(coords), 2):
                x = coords[i] * img_w
                y = coords[i + 1] * img_h
                points.append([x, y])
            polygons.append(np.array(points, dtype=np.float32))
            class_ids.append(class_id)

    return polygons, class_ids


def polygons_to_yolo_seg(polygons, class_ids, img_w, img_h):
    lines = []
    for polygon, class_id in zip(polygons, class_ids):
        normalized = []
        for pt in polygon:
            nx = max(0.0, min(1.0, pt[0] / img_w))
            ny = max(0.0, min(1.0, pt[1] / img_h))
            normalized.append(f"{nx:.6f}")
            normalized.append(f"{ny:.6f}")
        if len(normalized) >= 6:
            lines.append(f"{class_id} " + " ".join(normalized))
    return "\n".join(lines)


def augment_with_keypoints(image, polygons, class_ids):
    img_h, img_w = image.shape[:2]

    all_keypoints = []
    keypoint_meta = []

    for poly_idx, polygon in enumerate(polygons):
        for pt_idx, pt in enumerate(polygon):
            all_keypoints.append(tuple(pt))
            keypoint_meta.append((poly_idx, pt_idx))

    if not all_keypoints:
        augmented = transform(image=image)
        return augmented["image"], [], []

    kp_transform = A.Compose(
        transform.transforms,
        keypoint_params=A.KeypointParams(format="xy", remove_invisible=False)
    )

    try:
        augmented = kp_transform(image=image, keypoints=all_keypoints)
    except Exception:
        return image, polygons, class_ids

    aug_image = augmented["image"]
    aug_keypoints = augmented["keypoints"]
    aug_h, aug_w = aug_image.shape[:2]

    aug_polygons = [[] for _ in range(len(polygons))]
    for kp, (poly_idx, pt_idx) in zip(aug_keypoints, keypoint_meta):
        x = max(0, min(aug_w, kp[0]))
        y = max(0, min(aug_h, kp[1]))
        aug_polygons[poly_idx].append([x, y])

    final_polygons = []
    final_class_ids = []
    for poly_idx, poly in enumerate(aug_polygons):
        if len(poly) >= 3:
            final_polygons.append(np.array(poly, dtype=np.float32))
            final_class_ids.append(class_ids[poly_idx])

    return aug_image, final_polygons, final_class_ids


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=str, required=True, help="dataset_all 폴더 경로")
    args = parser.parse_args()

    dataset_dir = Path(args.dataset)
    orig_images = dataset_dir / "original" / "images"
    orig_labels = dataset_dir / "original" / "labels"
    aug_images = dataset_dir / "augmented" / "images"
    aug_labels = dataset_dir / "augmented" / "labels"

    aug_images.mkdir(parents=True, exist_ok=True)
    aug_labels.mkdir(parents=True, exist_ok=True)

    image_files = sorted([f for f in orig_images.glob("*.*")
                          if f.suffix.lower() in [".jpg", ".jpeg", ".png"]])

    print(f"원본 이미지: {len(image_files)}장")
    print(f"증강 배수: {AUG_MULTIPLIER}배")
    print(f"예상 증강 이미지: {len(image_files) * AUG_MULTIPLIER}장")
    print("=" * 50)

    total_aug = 0

    for img_idx, img_path in enumerate(image_files):
        image = cv2.imread(str(img_path))
        if image is None:
            continue

        img_h, img_w = image.shape[:2]
        label_path = orig_labels / (img_path.stem + ".txt")
        polygons, class_ids = parse_yolo_seg_label(label_path, img_w, img_h)

        for aug_idx in range(AUG_MULTIPLIER):
            aug_image, aug_polygons, aug_class_ids = augment_with_keypoints(
                image, polygons, class_ids
            )
            aug_h, aug_w = aug_image.shape[:2]

            aug_name = f"{img_path.stem}_aug{aug_idx:02d}"
            cv2.imwrite(str(aug_images / f"{aug_name}.jpg"), aug_image)

            label_str = polygons_to_yolo_seg(aug_polygons, aug_class_ids, aug_w, aug_h)
            with open(aug_labels / f"{aug_name}.txt", "w") as f:
                f.write(label_str)
            total_aug += 1

        if (img_idx + 1) % 20 == 0:
            print(f"  진행: {img_idx + 1}/{len(image_files)}")

    print("=" * 50)
    print(f"[증강 완료] {total_aug}장 생성")

    # train/val 분할
    print("\n[Train/Val 분할 생성]")
    train_images_dir = dataset_dir / "train" / "images"
    train_labels_dir = dataset_dir / "train" / "labels"
    val_images_dir = dataset_dir / "val" / "images"
    val_labels_dir = dataset_dir / "val" / "labels"

    train_images_dir.mkdir(parents=True, exist_ok=True)
    train_labels_dir.mkdir(parents=True, exist_ok=True)
    val_images_dir.mkdir(parents=True, exist_ok=True)
    val_labels_dir.mkdir(parents=True, exist_ok=True)

    # Val: 원본의 20%
    random.seed(42)
    orig_list = sorted([f for f in orig_images.glob("*.*")
                        if f.suffix.lower() in [".jpg", ".jpeg", ".png"]])
    random.shuffle(orig_list)
    val_count = max(1, int(len(orig_list) * 0.2))
    val_set = orig_list[:val_count]
    train_orig_set = orig_list[val_count:]

    # 증강 이미지 목록
    aug_list = sorted([f for f in aug_images.glob("*.*")
                       if f.suffix.lower() in [".jpg", ".jpeg", ".png"]])

    for img in val_set:
        shutil.copy2(img, val_images_dir / img.name)
        lbl = orig_labels / (img.stem + ".txt")
        if lbl.exists():
            shutil.copy2(lbl, val_labels_dir / lbl.name)

    for img in train_orig_set:
        shutil.copy2(img, train_images_dir / img.name)
        lbl = orig_labels / (img.stem + ".txt")
        if lbl.exists():
            shutil.copy2(lbl, train_labels_dir / lbl.name)

    for img in aug_list:
        shutil.copy2(img, train_images_dir / img.name)
        lbl = aug_labels / (img.stem + ".txt")
        if lbl.exists():
            shutil.copy2(lbl, train_labels_dir / lbl.name)

    print(f"  Val: {len(val_set)}장 (원본)")
    print(f"  Train: {len(train_orig_set) + len(aug_list)}장 (원본{len(train_orig_set)} + 증강{len(aug_list)})")

    # data.yaml 생성
    yaml_content = f"""path: {dataset_dir.resolve()}
train: train/images
val: val/images

names:
  0: leaf
  1: chlorosis
  2: insect_hole
"""
    yaml_path = dataset_dir / "data.yaml"
    with open(yaml_path, "w") as f:
        f.write(yaml_content)
    print(f"\n[data.yaml 생성] {yaml_path}")


if __name__ == "__main__":
    main()
