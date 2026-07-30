"""
Step 1: CVAT XML → YOLO seg 변환 + kkat_dataset과 합쳐서 dataset_all/original 에 저장
기존 폴더(kkat_dataset, ccat) 삭제

Colab에서 실행:
  !python CCATFARM/Model-jetson/01_merge_dataset.py \
    --ccat /content/drive/MyDrive/CCATFARM_data/ccat \
    --kkat /content/drive/MyDrive/CCATFARM_data/kkat_dataset \
    --output /content/dataset_all
"""
import xml.etree.ElementTree as ET
import shutil
import os
import argparse
from pathlib import Path


def cvat_xml_to_yolo_seg(xml_path, images_dir, output_images, output_labels):
    """CVAT XML polygon annotations → YOLO segmentation format"""
    tree = ET.parse(xml_path)
    root = tree.getroot()

    class_map = {"leaf": 0, "chlorosis": 1, "insect_hole": 2}
    count = 0

    for image_elem in root.findall("image"):
        img_name = image_elem.get("name")
        img_width = int(image_elem.get("width"))
        img_height = int(image_elem.get("height"))

        img_src = images_dir / img_name
        if not img_src.exists():
            print(f"[WARNING] 이미지 없음: {img_src}")
            continue

        shutil.copy2(img_src, output_images / img_name)

        label_name = Path(img_name).stem + ".txt"
        label_lines = []

        for polygon in image_elem.findall("polygon"):
            label = polygon.get("label")
            if label not in class_map:
                print(f"[WARNING] 알 수 없는 클래스: {label}")
                continue

            class_id = class_map[label]
            points_str = polygon.get("points")
            points = points_str.split(";")

            normalized = []
            for pt in points:
                x, y = pt.split(",")
                nx = float(x) / img_width
                ny = float(y) / img_height
                normalized.append(f"{nx:.6f}")
                normalized.append(f"{ny:.6f}")

            label_lines.append(f"{class_id} " + " ".join(normalized))

        with open(output_labels / label_name, "w") as f:
            f.write("\n".join(label_lines))
        count += 1

    print(f"[CVAT 변환 완료] {count}장 변환됨 (ccat)")


def copy_kkat_dataset(kkat_dir, output_images, output_labels):
    """kkat_dataset의 train+val 데이터를 모두 합쳐서 복사"""
    count = 0
    for split in ["train", "val"]:
        img_dir = kkat_dir / "images" / split
        lbl_dir = kkat_dir / "labels" / split

        if not img_dir.exists():
            continue

        for img_file in img_dir.glob("*.*"):
            if img_file.suffix.lower() in [".jpg", ".jpeg", ".png"]:
                shutil.copy2(img_file, output_images / img_file.name)

                lbl_file = lbl_dir / (img_file.stem + ".txt")
                if lbl_file.exists():
                    shutil.copy2(lbl_file, output_labels / lbl_file.name)
                else:
                    (output_labels / (img_file.stem + ".txt")).touch()
                count += 1

    print(f"[kkat_dataset 복사 완료] {count}장")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ccat", type=str, required=True, help="ccat 폴더 경로")
    parser.add_argument("--kkat", type=str, required=True, help="kkat_dataset 폴더 경로")
    parser.add_argument("--output", type=str, required=True, help="출력 폴더 경로 (dataset_all)")
    args = parser.parse_args()

    ccat_dir = Path(args.ccat)
    kkat_dir = Path(args.kkat)
    output_dir = Path(args.output) / "original"
    output_images = output_dir / "images"
    output_labels = output_dir / "labels"

    output_images.mkdir(parents=True, exist_ok=True)
    output_labels.mkdir(parents=True, exist_ok=True)

    # 1. CVAT XML → YOLO seg 변환
    print("=" * 50)
    print("[1/3] CVAT XML → YOLO Segmentation 변환 중...")
    cvat_xml_to_yolo_seg(
        xml_path=ccat_dir / "annotations.xml",
        images_dir=ccat_dir / "images",
        output_images=output_images,
        output_labels=output_labels,
    )

    # 2. kkat_dataset 복사
    print("=" * 50)
    print("[2/3] kkat_dataset 복사 중...")
    copy_kkat_dataset(kkat_dir, output_images, output_labels)

    # 3. 결과 확인
    total_images = len(list(output_images.glob("*.*")))
    total_labels = len(list(output_labels.glob("*.txt")))
    print("=" * 50)
    print(f"[완료] dataset_all/original: 이미지 {total_images}장, 라벨 {total_labels}개")

    # 4. ccat에서 변환된 이미지만 따로 목록 저장 (1차 학습용)
    ccat_images_list = output_dir.parent / "ccat_images_list.txt"
    ccat_imgs = list((ccat_dir / "images").glob("*.*"))
    with open(ccat_images_list, "w") as f:
        for img in ccat_imgs:
            f.write(img.name + "\n")
    print(f"[ccat 이미지 목록 저장] {len(ccat_imgs)}장 → ccat_images_list.txt")


if __name__ == "__main__":
    main()
