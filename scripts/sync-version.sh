#!/bin/bash

# Sync version numbers across platforms.
# Read version from tauri.conf.json and update iOS Info.plist.

# Version sync helper.
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")

echo "同步版本号: $VERSION"

# NoteLoom version sync helper.
PLIST_PATH="src-tauri/gen/apple/note-gen_iOS/Info.plist"

if [ -f "$PLIST_PATH" ]; then
# Version sync helper.
    sed -i '' '/CFBundleShortVersionString/,/<string>/s/<string>.*<\/string>/<string>'$VERSION'<\/string>/' "$PLIST_PATH"
    sed -i '' '/CFBundleVersion/,/<string>/s/<string>.*<\/string>/<string>'$VERSION'<\/string>/' "$PLIST_PATH"
    
    echo "iOS 版本号已更新为: $VERSION"
else
    echo "Info.plist 文件不存在，请先运行构建命令"
fi
