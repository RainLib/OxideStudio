#!/usr/bin/env python3
"""
从 logo.jpg 生成所有应用图标 (RGBA 格式)
确保所有 PNG 都包含 alpha 通道
"""

from PIL import Image
import os

def generate_icon(source_path, output_path, size):
    """生成指定尺寸的 RGBA PNG 图标"""
    try:
        # 打开源图片
        img = Image.open(source_path)

        # 转换为 RGBA (确保有 alpha 通道)
        if img.mode != 'RGBA':
            img = img.convert('RGBA')

        # 调整尺寸
        img = img.resize((size, size), Image.Resampling.LANCZOS)

        # 保存为 PNG
        img.save(output_path, 'PNG')
        print(f"✅ Created {output_path} ({size}x{size})")
        return True
    except Exception as e:
        print(f"❌ Error creating {output_path}: {e}")
        return False

def main():
    # 切换到 icons 目录
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    source = "logo.jpg"

    # 定义所有需要的图标尺寸
    icons = [
        (32, "32x32.png"),
        (128, "128x128.png"),
        (256, "128x128@2x.png"),
        (512, "icon.png"),

        # Windows Store 图标
        (30, "Square30x30Logo.png"),
        (44, "Square44x44Logo.png"),
        (50, "StoreLogo.png"),
        (71, "Square71x71Logo.png"),
        (89, "Square89x89Logo.png"),
        (107, "Square107x107Logo.png"),
        (142, "Square142x142Logo.png"),
        (150, "Square150x150Logo.png"),
        (284, "Square284x284Logo.png"),
        (310, "Square310x310Logo.png"),
    ]

    print(f"Generating RGBA PNG icons from {source}...")
    print()

    success_count = 0
    for size, filename in icons:
        if generate_icon(source, filename, size):
            success_count += 1

    print()
    print(f"✅ Successfully generated {success_count}/{len(icons)} icons")
    print()

    # 生成 .icns 文件 (macOS)
    print("Generating .icns file for macOS...")
    iconset_dir = "AppIcon.iconset"
    os.makedirs(iconset_dir, exist_ok=True)

    icns_sizes = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]

    for size, filename in icns_sizes:
        generate_icon(source, f"{iconset_dir}/{filename}", size)

    # 使用 iconutil 生成 .icns
    os.system(f"iconutil -c icns {iconset_dir} -o icon.icns")
    os.system(f"rm -rf {iconset_dir}")
    print("✅ Created icon.icns")
    print()

    # 生成 .ico 文件 (Windows)
    print("Generating .ico file for Windows...")
    try:
        images = []
        for size in [16, 32, 48, 64, 128, 256]:
            img = Image.open(source)
            if img.mode != 'RGBA':
                img = img.convert('RGBA')
            img = img.resize((size, size), Image.Resampling.LANCZOS)
            images.append(img)

        images[0].save(
            "icon.ico",
            format='ICO',
            sizes=[(img.size[0], img.size[1]) for img in images]
        )
        print("✅ Created icon.ico")
    except Exception as e:
        print(f"⚠️  Could not create .ico: {e}")

    print()
    print("="*50)
    print("✅ All icons generated with RGBA format!")
    print("="*50)

if __name__ == "__main__":
    main()
