import os
import sys
import zipfile

def main():
    if len(sys.argv) < 3:
        print("Usage: python pack-zip.py <dest_zip> <base_dir> [files...]")
        sys.exit(1)

    zip_path = sys.argv[1]
    base_dir = sys.argv[2]
    files = sys.argv[3:]

    # If no files specified, pack the entire base_dir
    os.makedirs(os.path.dirname(os.path.abspath(zip_path)), exist_ok=True)

    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        if files:
            for f in files:
                full_path = os.path.join(base_dir, f)
                zf.write(full_path, arcname=f)
        else:
            for root, _, filenames in os.walk(base_dir):
                for fn in filenames:
                    full_path = os.path.join(root, fn)
                    rel_path = os.path.relpath(full_path, base_dir)
                    zf.write(full_path, arcname=rel_path)

    print(f"Created archive: {zip_path}")

if __name__ == "__main__":
    main()
