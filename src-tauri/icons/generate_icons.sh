#!/bin/bash
# 使用 logo.jpg 生成所有应用图标

cd "$(dirname "$0")"

# 源文件
SOURCE="logo.jpg"
TEMP_PNG="logo_temp.png"

echo "Converting logo.jpg to PNG..."
sips -s format png "$SOURCE" --out "$TEMP_PNG"

# 定义所有需要的图标尺寸
# macOS 图标
declare -a SIZES=(
    "32:32x32.png"
    "128:128x128.png"
    "256:128x128@2x.png"
    "512:icon.png"

    # Windows Store 图标
    "30:Square30x30Logo.png"
    "44:Square44x44Logo.png"
    "50:StoreLogo.png"
    "71:Square71x71Logo.png"
    "89:Square89x89Logo.png"
    "107:Square107x107Logo.png"
    "142:Square142x142Logo.png"
    "150:Square150x150Logo.png"
    "284:Square284x284Logo.png"
    "310:Square310x310Logo.png"
)

echo "Generating icon files..."
for size_info in "${SIZES[@]}"; do
    IFS=':' read -r size filename <<< "$size_info"
    echo "Creating ${filename} (${size}x${size})..."
    sips -z "$size" "$size" "$TEMP_PNG" --out "$filename"
done

echo "Generating .icns file for macOS..."
# 创建 iconset 目录
ICONSET_DIR="AppIcon.iconset"
mkdir -p "$ICONSET_DIR"

# 生成 icns 所需的所有尺寸
sips -z 16 16 "$TEMP_PNG" --out "$ICONSET_DIR/icon_16x16.png"
sips -z 32 32 "$TEMP_PNG" --out "$ICONSET_DIR/icon_16x16@2x.png"
sips -z 32 32 "$TEMP_PNG" --out "$ICONSET_DIR/icon_32x32.png"
sips -z 64 64 "$TEMP_PNG" --out "$ICONSET_DIR/icon_32x32@2x.png"
sips -z 128 128 "$TEMP_PNG" --out "$ICONSET_DIR/icon_128x128.png"
sips -z 256 256 "$TEMP_PNG" --out "$ICONSET_DIR/icon_128x128@2x.png"
sips -z 256 256 "$TEMP_PNG" --out "$ICONSET_DIR/icon_256x256.png"
sips -z 512 512 "$TEMP_PNG" --out "$ICONSET_DIR/icon_256x256@2x.png"
sips -z 512 512 "$TEMP_PNG" --out "$ICONSET_DIR/icon_512x512.png"
sips -z 1024 1024 "$TEMP_PNG" --out "$ICONSET_DIR/icon_512x512@2x.png"

# 生成 .icns 文件
iconutil -c icns "$ICONSET_DIR" -o icon.icns

# 清理
rm -rf "$ICONSET_DIR"

echo "Generating .ico file for Windows..."
# 使用 sips 创建多个尺寸然后合并(macOS 原生不支持 ico,但我们可以创建 png)
# 对于 .ico 文件,建议使用在线工具或 ImageMagick
# 这里我们先创建一个 256x256 的作为临时方案
sips -z 256 256 "$TEMP_PNG" --out "icon_256.png"
echo "Note: For best .ico support, please use an online converter or ImageMagick"
echo "Temporary icon_256.png created for .ico conversion"

# 清理临时文件
rm "$TEMP_PNG"

echo "✅ All icons generated successfully!"
echo ""
echo "Generated icons:"
ls -lh *.png *.icns 2>/dev/null | awk '{print $9, $5}'
