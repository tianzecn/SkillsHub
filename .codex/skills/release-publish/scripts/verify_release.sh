#!/usr/bin/env bash
set -euo pipefail

REPO="${RELEASE_REPO:-tianzecn/SkillsHub}"
TAG="${1:-}"
ASSETS_DIR="${2:-}"

if [ -z "$TAG" ]; then
  echo "Usage: $0 vX.Y.Z [release_assets_dir]" >&2
  exit 2
fi

VERSION="${TAG#v}"
if [ "$VERSION" = "$TAG" ]; then
  echo "Tag must start with v, got: $TAG" >&2
  exit 2
fi

command -v gh >/dev/null || { echo "Missing gh CLI" >&2; exit 2; }
command -v curl >/dev/null || { echo "Missing curl" >&2; exit 2; }

required_assets="
PromptHub-${VERSION}-amd64.deb
PromptHub-${VERSION}-arm64.dmg
PromptHub-${VERSION}-arm64.dmg.blockmap
PromptHub-${VERSION}-arm64.zip
PromptHub-${VERSION}-arm64.zip.blockmap
PromptHub-${VERSION}-x64.AppImage
PromptHub-${VERSION}-x64.dmg
PromptHub-${VERSION}-x64.dmg.blockmap
PromptHub-${VERSION}-x64.zip
PromptHub-${VERSION}-x64.zip.blockmap
PromptHub-Setup-${VERSION}-arm64.exe
PromptHub-Setup-${VERSION}-x64.exe
latest-arm64.yml
latest-linux.yml
latest-mac-arm64.yml
latest-mac-x64.yml
latest-mac.yml
latest-x64.yml
latest.yml
"

required_manifests="
latest.yml
latest-arm64.yml
latest-x64.yml
latest-mac.yml
latest-mac-arm64.yml
latest-mac-x64.yml
latest-linux.yml
"

key_urls="
https://github.com/${REPO}/releases/latest/download/latest.yml
https://github.com/${REPO}/releases/latest/download/latest-arm64.yml
https://github.com/${REPO}/releases/latest/download/latest-mac.yml
https://github.com/${REPO}/releases/latest/download/latest-linux.yml
https://github.com/${REPO}/releases/latest/download/PromptHub-Setup-${VERSION}-x64.exe
https://github.com/${REPO}/releases/latest/download/PromptHub-Setup-${VERSION}-arm64.exe
https://github.com/${REPO}/releases/latest/download/PromptHub-${VERSION}-x64.dmg
https://github.com/${REPO}/releases/latest/download/PromptHub-${VERSION}-arm64.dmg
https://github.com/${REPO}/releases/latest/download/PromptHub-${VERSION}-amd64.deb
https://github.com/${REPO}/releases/latest/download/PromptHub-${VERSION}-x64.AppImage
"

echo "Checking GitHub Release ${REPO} ${TAG}"
release_json="$(gh release view "$TAG" --repo "$REPO" --json tagName,isDraft,isPrerelease,publishedAt,url,assets)"
release_tag="$(printf '%s' "$release_json" | node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(data.tagName);')"
is_draft="$(printf '%s' "$release_json" | node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(String(data.isDraft));')"
is_prerelease="$(printf '%s' "$release_json" | node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(String(data.isPrerelease));')"
release_url="$(printf '%s' "$release_json" | node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(data.url);')"
asset_count="$(printf '%s' "$release_json" | node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(String(data.assets.length));')"

if [ "$release_tag" != "$TAG" ]; then
  echo "Release tag mismatch: expected $TAG got $release_tag" >&2
  exit 1
fi
if [ "$is_draft" != "false" ]; then
  echo "Release is still draft" >&2
  exit 1
fi
if [ "$is_prerelease" != "false" ]; then
  echo "Release is prerelease" >&2
  exit 1
fi

latest_tag="$(gh release view --repo "$REPO" --json tagName --jq .tagName)"
if [ "$latest_tag" != "$TAG" ]; then
  echo "Latest release mismatch: expected $TAG got $latest_tag" >&2
  exit 1
fi

missing=0
for asset in $required_assets; do
  present="$(printf '%s' "$release_json" | ASSET_NAME="$asset" node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); const name=process.env.ASSET_NAME; process.stdout.write(data.assets.some(a=>a.name===name) ? "yes" : "no");')"
  if [ "$present" != "yes" ]; then
    echo "Missing asset: $asset" >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  exit 1
fi

if [ "$asset_count" != "19" ]; then
  echo "Unexpected asset count: $asset_count (expected 19)" >&2
  exit 1
fi

if [ -n "$ASSETS_DIR" ]; then
  if [ ! -d "$ASSETS_DIR" ]; then
    echo "Assets dir not found: $ASSETS_DIR" >&2
    exit 2
  fi
  for asset in $required_assets; do
    local_file="${ASSETS_DIR%/}/$asset"
    if [ ! -f "$local_file" ]; then
      echo "Local asset missing for digest check: $local_file" >&2
      exit 1
    fi
    local_digest="sha256:$(shasum -a 256 "$local_file" | awk '{print $1}')"
    remote_digest="$(printf '%s' "$release_json" | ASSET_NAME="$asset" node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); const name=process.env.ASSET_NAME; const asset=data.assets.find(a=>a.name===name); process.stdout.write(asset && asset.digest ? asset.digest : "");')"
    if [ "$remote_digest" != "$local_digest" ]; then
      echo "Digest mismatch for $asset: local=$local_digest remote=$remote_digest" >&2
      exit 1
    fi
  done
  echo "All remote asset digests match local files"
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

for manifest in $required_manifests; do
  url="https://github.com/${REPO}/releases/latest/download/${manifest}"
  output="${tmpdir}/${manifest}"
  curl -fsSL --max-time 45 "$url" -o "$output"
  if ! grep -q "^version: ${VERSION}$" "$output"; then
    echo "Manifest $manifest does not declare version ${VERSION}" >&2
    sed -n '1,8p' "$output" >&2
    exit 1
  fi
done

for url in $key_urls; do
  code="$(curl -I -L --max-time 60 -o /dev/null -s -w '%{http_code}' "$url")"
  echo "$code $url"
  if [ "$code" != "200" ]; then
    echo "URL check failed: $url returned $code" >&2
    exit 1
  fi
done

echo "Release verified: ${TAG}"
echo "URL: ${release_url}"
echo "Assets: ${asset_count}"
